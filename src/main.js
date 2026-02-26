import './style.css';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { marked } from 'marked';
import { auth } from './firebase.js'; // Importa o auth que criamos
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "firebase/auth";

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app-mvp1/sw.js')
    .then(reg => {
      reg.update();
      console.log('Service Worker Registrado v10');
    })
    .catch(err => console.log('Service Worker falhou:', err));
}


// --- VARIÁVEL GLOBAL PARA ETO FUTURA ---
// Quando você tiver o arquivo, vai alterar a função carregarEtoDoArquivo
let etoDoArquivo = null;

// Função placeholder para carregar ETo no futuro
async function carregarEtoDoArquivo() {
  try {
    // FUTURO: Descomentar quando tiver o arquivo 'eto_hoje.json'
    // const response = await fetch('eto_hoje.json');
    // const data = await response.json();
    // etoDoArquivo = data.eto;
    // document.getElementById('eto').value = etoDoArquivo;
    // document.getElementById('eto').disabled = true; // Bloqueia edição se veio do arquivo
    // document.getElementById('eto-source-msg').innerText = "Dado carregado automaticamente do arquivo.";
  } catch (error) {
    console.log("Modo manual de ETo ativo.");
  }
}

// Chama ao carregar a página
document.addEventListener("DOMContentLoaded", carregarEtoDoArquivo);

// Lógica de Exibição da Data
function verificarFase() {
  const fase = document.getElementById('fase_cultura').value;
  const grupoData = document.getElementById('grupo-data-florada');

  if (fase === 'producao') {
    grupoData.style.display = 'block';
  } else {
    grupoData.style.display = 'none';
  }
}

// --- MOTOR DE CÁLCULO (Embrapa + IF Sertão) ---
function executarCalculoADIM() {
  // 1. Obter ETo (Prioridade: Arquivo > Manual)
  let etoInput = parseFloat(document.getElementById('eto').value);
  let etoFinal = (etoDoArquivo !== null) ? etoDoArquivo : etoInput;

  // Validações Básicas
  if (isNaN(etoFinal) || etoFinal <= 0) {
    alert("Por favor, insira um valor válido para a ETo.");
    return;
  }

  // 2. Definir KC Inteligente (Lógica Embrapa/Semiárido)
  const fase = document.getElementById('fase_cultura').value;
  let kc = 0.50; // Padrão
  let faseDesc = "";
  const dataFloradaVal = document.getElementById('data_florada').value;

  if (fase === 'vegetativo') {
    kc = 0.50;
    faseDesc = "Vegetativo (Pós-poda)";
  } else if (fase === 'inducao') {
    kc = 0.20;
    faseDesc = "Indução (PBZ)";
  } else if (fase === 'pos_colheita') {
    kc = 0.45;
    faseDesc = "Repouso Pós-Colheita";
  } else if (fase === 'producao') {
    if (!dataFloradaVal) {
      alert("Para fase de produção, informe a Data da Florada!");
      return;
    }
    // Cálculo de Dias
    const dataFlorada = new Date(dataFloradaVal);
    const hoje = new Date();
    const diffTime = Math.abs(hoje - dataFlorada);
    const dias = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    faseDesc = `Produção (${dias} dias)`;

    // Curva Kc Manga (Silva et al.)
    if (dias <= 30) kc = 0.80;        // Floração
    else if (dias <= 60) kc = 0.90;   // Chumbinho
    else if (dias <= 100) kc = 0.95;  // Enchimento (Pico)
    else kc = 0.70;                   // Maturação
  }

  // 3. Captura dos outros dados
  const p = parseFloat(document.getElementById('precipitacao').value) || 0;
  const pm = parseFloat(document.getElementById('pm').value) || 85;
  const ep = parseFloat(document.getElementById('ep').value);
  const el = parseFloat(document.getElementById('el').value);
  const q = parseFloat(document.getElementById('q').value);
  const n = parseFloat(document.getElementById('n').value);
  const ef = (parseFloat(document.getElementById('ef').value) || 90) / 100;
  const nl = parseFloat(document.getElementById('nl').value) || 1.0;

  if (!ep || !el || !q || !n) {
    alert("Preencha os dados de espaçamento e vazão.");
    return;
  }

  // 4. Algoritmo Matemático (ADIM)
  const kl = 0.1 * Math.sqrt(pm); // Keller & Bliesner
  const etr = etoFinal * kc * kl;

  let lli = etr - p;
  if (lli < 0) lli = 0; // Chuva supriu tudo

  const lbi = lli / (ef * nl);
  const aup = ep * el;
  const vol = lbi * aup; // Volume Litros

  // Tempo em Horas Decimais
  const tfHorasDecimais = vol / (q * n);

  // Formatação Tempo
  const horas = Math.floor(tfHorasDecimais);
  const minutos = Math.round((tfHorasDecimais - horas) * 60);

  // 5. Exibição
  let textoTempo = "";
  if (tfHorasDecimais <= 0) {
    textoTempo = "0h 00min (Chuva suficiente)";
    document.getElementById('adim-results').style.backgroundColor = "#E3F2FD"; // Azul se não precisar regar
  } else {
    textoTempo = `${horas}h ${minutos}min`;
    document.getElementById('adim-results').style.backgroundColor = "#E8F5E9"; // Verde padrão
  }

  document.getElementById('out-tempo').innerText = textoTempo;
  document.getElementById('out-vol').innerText = vol.toFixed(1) + " L";
  document.getElementById('out-fase-desc').innerText = faseDesc;
  document.getElementById('out-kc').innerText = kc.toFixed(2);
  document.getElementById('out-eto-usada').innerText = etoFinal.toFixed(1) + " mm";

  document.getElementById('adim-results').style.display = 'block';

  // Feedback visual
  const feedback = document.getElementById('fase-feedback');
  feedback.style.display = 'block';
  feedback.innerText = `Cálculo baseado em Kc de ${kc.toFixed(2)} para ${faseDesc}.`;
}


document.addEventListener("DOMContentLoaded", () => {
  const SENHA_SECRETA = "cyberagro2025";

  // *** URL DO WEBHOOK DO N8N (PRODUÇÃO) ***
  const N8N_CHAT_URL = "https://n8n-agent-476522137012.us-central1.run.app/webhook/chat";

  // Telas
  const loginScreen = document.getElementById("login-screen");
  const registerScreen = document.getElementById("register-screen");
  const selecaoCulturaScreen = document.getElementById("selecao-cultura-screen");
  const dashboardScreen = document.getElementById("dashboard-screen");
  const irrigacaoScreen = document.getElementById("irrigacao-screen");
  const chatScreen = document.getElementById("chat-screen");
  const perfilScreen = document.getElementById("perfil-screen");

  // Elementos UI
  const appFooter = document.querySelector(".app-footer");
  const btnChat = document.getElementById("btnChat");
  const loginButton = document.getElementById("loginButton");
  const usernameInput = document.getElementById("usernameInput");
  const passwordInput = document.getElementById("passwordInput");
  const loginError = document.getElementById("loginError");

  // Botões Seleção
  const btnIconeManga = document.getElementById("btnIconeManga");
  const btnIconeUva = document.getElementById("btnIconeUva");
  const btnIconePitaya = document.getElementById("btnIconePitaya");

  // Navegação Centralizada
  function nav(telaId) {
    // Esconde todas as telas
    const telas = [loginScreen, registerScreen, selecaoCulturaScreen, dashboardScreen, irrigacaoScreen, chatScreen, perfilScreen];
    telas.forEach(s => s.classList.add('hide'));

    // Mostra a tela desejada
    const telaAtual = document.getElementById(telaId);
    telaAtual.classList.remove('hide');
    telaAtual.style.display = (telaId === 'chat-screen') ? 'flex' : 'block';

    // Lógica Rodapé/Chat
    if (telaId === 'login-screen' || telaId === 'register-screen' || telaId === 'selecao-cultura-screen') {
      appFooter.style.display = 'none';
      btnChat.style.display = 'none';
    } else if (telaId === 'chat-screen') {
      appFooter.style.display = 'none';
      btnChat.style.display = 'none';
      // Foca no input quando abre o chat
      setTimeout(() => {
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.focus();
      }, 300);
    } else {
      appFooter.style.display = 'flex';
      appFooter.style.pointerEvents = 'auto';
      btnChat.style.display = 'block';
      btnChat.style.pointerEvents = 'auto';
    }

    // Atualizar abas ativas
    const footerBtns = document.querySelectorAll('.footer-btn');
    footerBtns.forEach(btn => {
      btn.classList.remove('active');
      const onClickAttr = btn.getAttribute('onclick');
      if (onClickAttr && onClickAttr.includes(`'${telaId}'`)) {
        btn.classList.add('active');
      }
    });
  }

  // Inicialização
  nav('login-screen');

  // --- Eventos ---
  // Preencher campos se existirem no localStorage
  if (localStorage.getItem("savedUsername")) {
    usernameInput.value = localStorage.getItem("savedUsername");
  }
  if (localStorage.getItem("savedPassword")) {
    passwordInput.value = localStorage.getItem("savedPassword");
  }

  // --- LÓGICA DE LOGIN REAL ---
  loginButton.onclick = () => {
    const email = usernameInput.value;
    const password = passwordInput.value;

    // Limpa erro anterior
    loginError.style.display = "none";
    loginButton.disabled = true; // Evita duplo clique
    loginButton.textContent = "Entrando...";

    signInWithEmailAndPassword(auth, email, password)
      .then((userCredential) => {
        // Sucesso! O usuário entrou.
        console.log("Admin logado:", userCredential.user.email);
        nav('dashboard-screen');
      })
      .catch((error) => {
        // Erro! Senha errada ou usuário não existe.
        console.error("Erro ao logar:", error);
        loginError.style.display = "block";
        loginError.textContent = "E-mail ou senha incorretos.";
      })
      .finally(() => {
        loginButton.disabled = false;
        loginButton.textContent = "Entrar";
      });
  };
  passwordInput.addEventListener("keypress", (e) => { if (e.key === "Enter") loginButton.click(); });

  // --- MANTER O USUÁRIO LOGADO ---
  // Isso verifica se o admin já está logado quando recarrega a página
  onAuthStateChanged(auth, (user) => {
    if (user) {
      // Se já estiver logado, pula direto pro dashboard (opcional)
      // Se quiser forçar login sempre, pode remover essa parte interna
      console.log("Usuário já está logado:", user.email);
      // nav('dashboard-screen'); // Descomente se quiser pular a tela de login
    }
  });

  // Lógica de Registro
  const registerButton = document.getElementById("registerButton");
  const regNomeInput = document.getElementById("regNomeInput");
  const regEmailInput = document.getElementById("regEmailInput");
  const regPasswordInput = document.getElementById("regPasswordInput");
  const regPasswordConfirmInput = document.getElementById("regPasswordConfirmInput");
  const registerError = document.getElementById("registerError");

  if (registerButton) {
    registerButton.onclick = () => {
      registerError.style.display = "none";
      if (!regNomeInput.value || !regEmailInput.value || !regPasswordInput.value) {
        registerError.textContent = "Preencha todos os campos.";
        registerError.style.display = "block";
        return;
      }
      if (regPasswordInput.value !== regPasswordConfirmInput.value) {
        registerError.textContent = "As senhas não coincidem.";
        registerError.style.display = "block";
        return;
      }
      registerButton.disabled = true;
      registerButton.textContent = "Criando...";

      createUserWithEmailAndPassword(auth, regEmailInput.value, regPasswordInput.value)
        .then((userCredential) => {
          console.log("Usuário criado:", userCredential.user.email);
          nav('dashboard-screen');
        })
        .catch((error) => {
          console.error("Erro ao criar conta:", error);
          let erroMsg = "Erro ao criar conta.";
          if (error.code === 'auth/email-already-in-use') {
            erroMsg = "Este e-mail já está em uso.";
          } else if (error.code === 'auth/weak-password') {
            erroMsg = "A senha deve ter pelo menos 6 caracteres.";
          }
          registerError.textContent = erroMsg;
          registerError.style.display = "block";
        })
        .finally(() => {
          registerButton.disabled = false;
          registerButton.textContent = "Criar Conta";
        });
    };
  }

  btnIconeManga.onclick = () => nav('dashboard-screen');
  btnIconeUva.onclick = () => alert("Em breve!");
  btnIconePitaya.onclick = () => alert("Em breve!");

  // --- LÓGICA DE SAIR (LOGOUT) ---
  document.getElementById("navSair").onclick = (e) => {
    e.preventDefault();
    if (confirm("Deseja realmente sair?")) {
      signOut(auth).then(() => {
        alert("Deslogado com sucesso!");
        window.location.reload();
      });
    }
  };



  // --- LÓGICA DO CHAT NATIVO COM WEBHOOK ---
  const chatMessages = document.getElementById('chatMessages');
  const chatInput = document.getElementById('chatInput');
  const chatSendBtn = document.getElementById('chatSendBtn');
  let isTyping = false;

  function formatTime() {
    const now = new Date();
    return now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  }

  function addMessage(text, isUser = false) {
    // Remove empty state se existir
    const emptyState = chatMessages.querySelector('.chat-empty-state');
    if (emptyState) emptyState.remove();

    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${isUser ? 'user' : 'bot'}`;

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    if (isUser) {
      avatar.textContent = 'Você';
    } else {
      const img = document.createElement('img');
      img.src = 'logo.png?v=9';
      img.alt = 'Bot';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.borderRadius = '50%';
      img.style.objectFit = 'cover';
      avatar.appendChild(img);
    }

    const contentWrapper = document.createElement('div');
    contentWrapper.style.display = 'flex';
    contentWrapper.style.flexDirection = 'column';
    contentWrapper.style.maxWidth = '100%';

    const content = document.createElement('div');
    content.className = 'chat-message-content';
    // Markdown para mensagens do bot, texto simples para usuário
    let rendered;
    if (isUser) {
      rendered = text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\n/g, '<br>');
    } else if (window.marked) {
      rendered = marked.parse(text);
    } else {
      rendered = text.replace(/\n/g, '<br>');
    }
    content.innerHTML = rendered;

    const time = document.createElement('div');
    time.className = 'chat-message-time';
    time.textContent = formatTime();

    contentWrapper.appendChild(content);
    contentWrapper.appendChild(time);

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentWrapper);
    chatMessages.appendChild(messageDiv);

    // Scroll suave para o final
    setTimeout(() => {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  }

  function showTypingIndicator() {
    if (isTyping) return;
    isTyping = true;

    const typingDiv = document.createElement('div');
    typingDiv.className = 'chat-message bot';
    typingDiv.id = 'typingIndicator';

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    const img = document.createElement('img');
    img.src = 'logo.png?v=9';
    img.alt = 'Bot';
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.borderRadius = '50%';
    img.style.objectFit = 'cover';
    avatar.appendChild(img);

    const indicator = document.createElement('div');
    indicator.className = 'chat-typing-indicator';
    indicator.innerHTML = '<div class="chat-typing-dot"></div><div class="chat-typing-dot"></div><div class="chat-typing-dot"></div>';

    typingDiv.appendChild(avatar);
    typingDiv.appendChild(indicator);
    chatMessages.appendChild(typingDiv);

    setTimeout(() => {
      chatMessages.scrollTo({
        top: chatMessages.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  }

  function hideTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) {
      indicator.remove();
      isTyping = false;
    }
  }

  async function sendMessage() {
    const message = chatInput.value.trim();
    if (!message || isTyping) return;

    // Adiciona mensagem do usuário
    addMessage(message, true);
    chatInput.value = '';
    chatSendBtn.disabled = true;

    // Mostra indicador de digitação
    showTypingIndicator();

    try {
      // Obtém ou cria um chatId para manter a sessão
      let chatId = localStorage.getItem('chatSessionId');
      if (!chatId) {
        chatId = `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        localStorage.setItem('chatSessionId', chatId);
      }

      // Prepara o payload para o webhook do n8n
      const payload = {
        message: message,
        text: message,
        chatId: chatId,
        sessionId: chatId
      };

      console.log('Enviando para webhook:', N8N_CHAT_URL);
      console.log('Payload:', payload);

      // Envia para o Webhook do n8n via HTTP POST
      // O n8n webhook espera os dados no body da requisição
      const response = await fetch(N8N_CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        mode: 'cors', // Permite CORS
        credentials: 'omit', // Não envia cookies
        body: JSON.stringify(payload)
      });

      // Verifica se a requisição foi feita
      if (!response) {
        throw new Error('Nenhuma resposta recebida do servidor');
      }

      console.log('Response status:', response.status);
      console.log('Response headers:', response.headers);

      hideTypingIndicator();

      if (response.ok) {
        let data;
        const contentType = response.headers.get('content-type');
        const responseText = await response.text();

        console.log('Response text:', responseText);
        console.log('Content-Type:', contentType);

        if (contentType && contentType.includes('application/json')) {
          try {
            data = JSON.parse(responseText);
            console.log('Response data:', data);
          } catch (e) {
            console.error('Erro ao parsear JSON:', e);
            data = { output: responseText, response: responseText };
          }
        } else {
          try {
            data = JSON.parse(responseText);
          } catch {
            data = { output: responseText, response: responseText };
          }
        }

        // Webhook do n8n retorna em diferentes formatos
        const botMessage = data.output ||
          data.response ||
          data.message ||
          data.text ||
          data.answer ||
          (typeof data === 'string' ? data : 'Desculpe, não consegui processar sua mensagem.');

        console.log('Mensagem extraída:', botMessage);
        addMessage(botMessage, false);

        // Atualiza chatId se fornecido na resposta
        if (data.chatId) {
          localStorage.setItem('chatSessionId', data.chatId);
        }
      } else {
        const errorText = await response.text();
        console.error('Erro HTTP:', response.status, errorText);

        let errorMessage = 'Desculpe, ocorreu um erro ao processar sua mensagem.';

        try {
          const errorData = JSON.parse(errorText);
          errorMessage = errorData.message || errorData.error || errorMessage;
          console.error('Erro parseado:', errorData);
        } catch {
          if (errorText) {
            console.error('Erro detalhado (texto):', errorText);
          }
        }

        addMessage(`Erro ${response.status}: ${errorMessage}. Tente novamente.`, false);
      }
    } catch (error) {
      hideTypingIndicator();
      console.error('Erro completo no chat:', error);
      console.error('Stack trace:', error.stack);

      let errorMsg = 'Erro de conexão. ';
      if (error.message) {
        errorMsg += error.message;
      } else if (error.name === 'TypeError' && error.message.includes('fetch')) {
        errorMsg += 'Não foi possível conectar ao servidor. Verifique se o webhook está ativo no n8n.';
      } else {
        errorMsg += 'Verifique sua internet e tente novamente.';
      }

      addMessage(errorMsg, false);
    } finally {
      chatSendBtn.disabled = false;
      chatInput.focus();
    }
  }

  // Event listeners do chat
  if (chatSendBtn && chatInput) {
    chatSendBtn.addEventListener('click', sendMessage);
    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
      }
    });
  }

  // ===============================
  // DASHBOARD: EXPORTAÇÃO DE MANGA (EXCEL LOCAL)
  // ===============================
  let mangaChartInstance = null;
  let mangoLoadedOnce = false;

  // Botão atualizar
  const btnReloadMango = document.getElementById("btnReloadMango");
  if (btnReloadMango) btnReloadMango.addEventListener("click", () => loadMangoDashboard(true));

  // Hook: sempre que entrar no dashboard, carrega (1ª vez)
  const _navOriginal = nav;
  nav = function (telaId) {
    _navOriginal(telaId);
    if (telaId === "dashboard-screen" && !mangoLoadedOnce) {
      loadMangoDashboard(false);
    }
  };

  // Funções Globais para os botões onclick do HTML
  window.nav = nav;

  function setDashStatus(kind, text) {
    const el = document.getElementById("dashStatus");
    if (!el) return;
    el.classList.remove("loading", "error");
    if (kind === "loading") el.classList.add("loading");
    if (kind === "error") el.classList.add("error");
    el.textContent = text || "Pronto";
  }

  function showDashError(msg) {
    const box = document.getElementById("dashError");
    if (!box) return;
    if (!msg) { box.classList.add("hide"); box.textContent = ""; return; }
    box.classList.remove("hide");
    box.textContent = msg;
  }

  function fmtUSD(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
  }
  function fmtKG(v) {
    return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 }).format(v) + " kg";
  }
  function fmtUSDkg(v) {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(v) + "/kg";
  }

  function renderKpis(labels, palmer, tommy) {
    const palmerVal = palmer.filter(p => p > 0);
    const tommyVal = tommy.filter(t => t > 0);

    const avgPalmer = palmerVal.length ? (palmerVal.reduce((a, b) => a + b, 0) / palmerVal.length) : 0;
    const avgTommy = tommyVal.length ? (tommyVal.reduce((a, b) => a + b, 0) / tommyVal.length) : 0;

    let maxPrice = 0;
    let maxMonth = "—";
    let bestVar = "";

    labels.forEach((lab, i) => {
      if (palmer[i] > maxPrice) { maxPrice = palmer[i]; maxMonth = lab; bestVar = "Palmer"; }
      if (tommy[i] > maxPrice) { maxPrice = tommy[i]; maxMonth = lab; bestVar = "Tommy"; }
    });

    document.getElementById("kpiFobTotal").textContent = "R$ " + avgPalmer.toFixed(2).replace('.', ',');
    document.getElementById("kpiFobFoot").textContent = `Média do período selecionado`;

    document.getElementById("kpiKgTotal").textContent = "R$ " + avgTommy.toFixed(2).replace('.', ',');
    document.getElementById("kpiKgFoot").textContent = `Média do período selecionado`;

    document.getElementById("kpiUsdKg").textContent = "R$ " + maxPrice.toFixed(2).replace('.', ',');
    document.getElementById("kpiUsdKgFoot").textContent = `Maior valor alcançado na série`;

    document.getElementById("kpiBestMonth").textContent = maxMonth;
    document.getElementById("kpiBestMonthFoot").textContent = `Variedade: ${bestVar} a R$ ${maxPrice.toFixed(2).replace('.', ',')}`;
  }

  function renderTable(labels, palmer, tommy) {
    const tbody = document.getElementById("mangaTbody");
    if (!tbody) return;

    if (!labels.length) {
      tbody.innerHTML = `<tr><td colspan="4" class="td-muted">Sem dados no período.</td></tr>`;
      return;
    }

    tbody.innerHTML = labels.map((lab, i) => {
      let soma = 0;
      let qtd = 0;
      if (palmer[i] > 0) { soma += palmer[i]; qtd++; }
      if (tommy[i] > 0) { soma += tommy[i]; qtd++; }

      let mediaMes = qtd > 0 ? (soma / qtd) : 0;

      return `
            <tr>
              <td>${lab}</td>
              <td style="text-align:right;">R$ ${palmer[i] > 0 ? palmer[i].toFixed(2).replace('.', ',') : '-'}</td>
              <td style="text-align:right;">R$ ${tommy[i] > 0 ? tommy[i].toFixed(2).replace('.', ',') : '-'}</td>
              <td style="text-align:right; font-weight:600;">R$ ${mediaMes > 0 ? mediaMes.toFixed(2).replace('.', ',') : '-'}</td>
            </tr>
          `;
    }).join("");
  }

  function renderChart(labels, palmer, tommy) {
    const canvas = document.getElementById("mangaChart");
    if (!canvas) return;

    if (mangaChartInstance) {
      mangaChartInstance.destroy();
      mangaChartInstance = null;
    }

    mangaChartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Palmer (R$/kg)",
            data: palmer,
            borderColor: "#e44d26",
            backgroundColor: "#e44d26",
            tension: 0.25,
            pointRadius: 4,
            borderWidth: 2
          },
          {
            label: "Tommy (R$/kg)",
            data: tommy,
            borderColor: "#007bff",
            backgroundColor: "#007bff",
            tension: 0.25,
            pointRadius: 4,
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: true }
        },
        scales: {
          y: {
            beginAtZero: false,
            ticks: {
              callback: (v) => "R$ " + v.toFixed(2).replace('.', ',')
            },
            title: { display: true, text: "Preço Ofertado (R$/kg)" }
          }
        }
      }
    });
  }

  async function loadMangoDashboard(forceRefresh = false) {
    mangoLoadedOnce = true;
    showDashError("");
    setDashStatus("loading", "Lendo Planilha Local...");
    const periodEl = document.getElementById("dashPeriod");

    const tbody = document.getElementById("mangaTbody");
    if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="td-muted">Carregando…</td></tr>`;

    try {
      const filePath = "exportacao_manga_2025.xlsx";
      let fetchUrl = filePath;
      if (forceRefresh) fetchUrl += "?v=" + new Date().getTime();

      const r = await fetch(fetchUrl);
      if (!r.ok) {
        throw new Error(`Falha HTTP ao carregar tabela local: ${r.status}`);
      }

      const arrayBuffer = await r.arrayBuffer();

      if (typeof XLSX === "undefined") {
        throw new Error("A biblioteca local SheetJS (XLSX) não carregou.");
      }

      const workbook = XLSX.read(arrayBuffer, { type: "array" });
      const worksheet = workbook.Sheets[workbook.SheetNames[0]];
      const rawData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (!rawData || rawData.length < 2) {
        throw new Error("Faltam dados lineares ou cabecalho ausente.");
      }

      const monthlyData = {};

      rawData.slice(1).forEach(row => {
        if (!row || row.length < 7) return;

        const produtoRaw = String(row[0] || "").trim().toLowerCase();
        const mes = String(row[2] || "").trim().padStart(2, '0');
        const ano = String(row[3] || "").trim();
        const preco = Number(row[6]) || 0;

        if (!mes || !ano || preco === 0) return;

        const labelStr = `${mes}/${ano}`;

        if (!monthlyData[labelStr]) {
          monthlyData[labelStr] = { palmer: 0, tommy: 0 };
        }

        if (produtoRaw.includes("palmer")) {
          monthlyData[labelStr].palmer = preco;
        } else if (produtoRaw.includes("tommy")) {
          monthlyData[labelStr].tommy = preco;
        }
      });

      // Sort labels chronologically (format MM/YYYY)
      const labels = Object.keys(monthlyData).sort((a, b) => {
        const [ma, ya] = a.split('/');
        const [mb, yb] = b.split('/');
        if (ya !== yb) return Number(ya) - Number(yb);
        return Number(ma) - Number(mb);
      });

      const palmerData = labels.map(l => monthlyData[l].palmer);
      const tommyData = labels.map(l => monthlyData[l].tommy);

      if (labels.length === 0) {
        throw new Error("Nenhum dado formatável foi encontrado na leitura das linhas.");
      }

      if (periodEl) {
        periodEl.textContent = `${labels[0]} → ${labels[labels.length - 1]}`;
      }

      renderKpis(labels, palmerData, tommyData);
      renderChart(labels, palmerData, tommyData);
      renderTable(labels, palmerData, tommyData);

      setDashStatus("ok", "Planilha lida");
    } catch (err) {
      console.error("[MANGO] Error Planilha:", err);
      setDashStatus("error", "Falha leitura");
      showDashError("Erro: " + err.message + " Certifique-se de hospedar pelo npx serve para evitar restrições de arquivo local.");
      if (periodEl) periodEl.textContent = "Falha ao ler Excel";
      if (tbody) tbody.innerHTML = `<tr><td colspan="4" class="td-muted">Falha local.</td></tr>`;
    }
  }

});



// Expose functions to window so they can be called from inline event handlers (onclick, onchange)
window.carregarEtoDoArquivo = typeof carregarEtoDoArquivo !== 'undefined' ? carregarEtoDoArquivo : () => { };
window.verificarFase = typeof verificarFase !== 'undefined' ? verificarFase : () => { };
window.executarCalculoADIM = typeof executarCalculoADIM !== 'undefined' ? executarCalculoADIM : () => { };

// Firebase imports mapping isn't necessary inside the vanilla js anymore, as it's a module

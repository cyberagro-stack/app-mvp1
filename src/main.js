import './style.css';
import Chart from 'chart.js/auto';
import * as XLSX from 'xlsx';
import { marked } from 'marked';
import * as pyeto from './pyeto.js';
import { db, auth } from './firebase.js'; // Importa firestore (db) e auth
import { signInWithEmailAndPassword, onAuthStateChanged, signOut, createUserWithEmailAndPassword } from "firebase/auth";
import { collection, addDoc, serverTimestamp, query, where, getDocs, onSnapshot, limit, orderBy } from "firebase/firestore";

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

// Variável global para rastrear a opção de ETo selecionada
let etoOptionSelected = 'manual';

// --- Função Corrigir Decimal Excel ---
function corrigirDecimalExcel(valor) {
  // Se a biblioteca XLSX já converteu a célula corrompida em uma Data nativa do JS
  if (valor instanceof Date) {
    const dia = valor.getDate();
    const mes = valor.getMonth() + 1; // getMonth é zero-indexed
    return parseFloat(`${dia}.${mes}`);
  }
  // Se por acaso vier como string ISO "2026-01-24..."
  if (typeof valor === 'string' && valor.startsWith('2026-')) {
    const partes = valor.split('-');
    if (partes.length >= 3) {
      const mes = parseInt(partes[1], 10);
      const dia = parseInt(partes[2], 10);
      return parseFloat(`${dia}.${mes}`);
    }
  }
  // Se vier um texto com vírgula, ex: "24,1"
  if (typeof valor === 'string' && valor.includes(',')) {
    valor = valor.replace(',', '.');
  }
  // Qualquer outro número
  const val = parseFloat(valor);
  return isNaN(val) ? null : val;
}

// --- Função Calcular ETo via IF Sertão ---
async function calcularEtoIFSertao() {
  try {
    const selectedText = document.getElementById('eto-selected-text');
    selectedText.innerHTML = '⏳ Calculando...';

    // 1. Puxa o arquivo atualizado da raiz (pasta public do Vite)
    const response = await fetch('relatorio_meteoro.xlsx');
    if (!response.ok) throw new Error("Erro ao baixar arquivo Excel.");
    const buffer = await response.arrayBuffer();

    // 2. Lê Excel
    const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
    const wsName = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { raw: false, dateNF: 'YYYY-MM-DD' });

    // Determina a data "ontem"
    const hoje = new Date();
    hoje.setDate(hoje.getDate() - 1);
    const ontemStr = hoje.toISOString().split('T')[0];

    // 3. Organiza/Filtra
    let somaChuva = 0;
    let count = 0;

    // Calcular chuva somando TODA a coluna "chuv_total" do arquivo
    let totalChuvaArquivo = 0;
    rows.forEach(r => {
      totalChuvaArquivo += parseFloat(r.chuv_total) || 0;
    });
    let maxT = -999, minT = 999;
    let sumTempExt = 0, sumUmid = 0, sumVento = 0, sumPress = 0, sumRad = 0;

    let rowOntem = rows.filter(r => r.data_hora && String(r.data_hora).startsWith(ontemStr));

    // Fallback: se não tiver ontem, pega o último dia do arquivo que tem dados validos
    if (rowOntem.length === 0 && rows.length > 0) {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].data_hora) {
          const ultimaDataStr = String(rows[i].data_hora).split(' ')[0];
          rowOntem = rows.filter(r => r.data_hora && String(r.data_hora).startsWith(ultimaDataStr));
          if (rowOntem.length > 0) break;
        }
      }
    }

    if (rowOntem.length === 0) throw new Error("Sem dados");

    // 4. Agrupa os dados
    rowOntem.forEach(r => {
      const temp_ext = corrigirDecimalExcel(r.temp_ext);
      const temp_max = corrigirDecimalExcel(r.temp_max);
      const temp_min = corrigirDecimalExcel(r.temp_min);
      const vel_vento = corrigirDecimalExcel(r.vel_vento);
      const press_ar = corrigirDecimalExcel(r.press_ar);
      const umid_ext = parseFloat(r.umid_ext);
      const rad_solar = parseFloat(r.rad_solar);
      const chuv_total = parseFloat(r.chuv_total) || 0;

      if (temp_ext !== null) {
        sumTempExt += temp_ext;
        sumUmid += umid_ext;
        sumVento += vel_vento;
        sumPress += press_ar;
        sumRad += rad_solar;
        somaChuva += chuv_total;
        if (temp_max > maxT) maxT = temp_max;
        if (temp_min < minT) minT = temp_min;
        count++;
      }
    });

    if (count === 0) throw new Error("Erro nos dados base");

    const T_med = sumTempExt / count;
    const UR_med = sumUmid / count;
    const u2 = sumVento / count;
    const pressao_kpa = (sumPress / count) / 10.0;
    const Rs_W = sumRad / count;

    // 5. Parâmetros de Petrolina
    const altitude = 376.0;
    const latitude_rad = pyeto.deg2rad(-9.38);
    const rs_mj = Rs_W * 0.0864;

    // Dia do ano
    let checkDate = hoje;
    if (rowOntem.length > 0 && rowOntem[0].data_hora) checkDate = new Date(rowOntem[0].data_hora);
    const start = new Date(checkDate.getFullYear(), 0, 0);
    const dia_ano = Math.floor(((checkDate - start) + ((start.getTimezoneOffset() - checkDate.getTimezoneOffset()) * 60 * 1000)) / (1000 * 60 * 60 * 24));

    // Cálculos PyETo
    const es = pyeto.svp_from_t(maxT) * 0.5 + pyeto.svp_from_t(minT) * 0.5;
    const ea = pyeto.avp_from_rhmean(pyeto.svp_from_t(minT), pyeto.svp_from_t(maxT), UR_med);
    const delta = pyeto.delta_svp(T_med);
    const gama = pyeto.psy_const(pressao_kpa);
    const ra = pyeto.extraterrestrial_rad(dia_ano, latitude_rad);
    const rso = pyeto.cs_rad(altitude, ra);
    const rns = pyeto.net_in_sw_rad(rs_mj);
    const rnl = pyeto.net_out_lw_rad(minT, maxT, ea, rs_mj, rso);
    const rn = pyeto.net_rad(rns, rnl);

    const eto = pyeto.fao56_penman_monteith(rn, T_med, u2, es, ea, delta, gama);

    // 6. Prepara envio
    const finalEto = isNaN(eto) ? 0 : parseFloat(eto.toFixed(2));
    const finalChuva = parseFloat(totalChuvaArquivo.toFixed(2));

    etoDoArquivo = finalEto;
    document.getElementById('eto').value = finalEto;
    document.getElementById('precipitacao').value = finalChuva;

    selectedText.innerHTML = `🏫 IFSertão: ${finalEto} mm/dia`;

  } catch (e) {
    document.getElementById('eto-selected-text').innerHTML = '⚠️ Erro - Usar Manual';
  }
}

// --- Função Calcular ETo via Estação Própria (Manual Avançado) ---
window.calcularEtoEstacaoPropria = function () {
  const selectedText = document.getElementById('eto-selected-text');

  // Pegar inputs
  const tmax = parseFloat(document.getElementById('ep_tmax').value);
  const tmin = parseFloat(document.getElementById('ep_tmin').value);
  const ur = parseFloat(document.getElementById('ep_ur').value);
  const vento = parseFloat(document.getElementById('ep_vento').value);
  const chuva = parseFloat(document.getElementById('ep_chuva').value);
  const alt = parseFloat(document.getElementById('ep_alt').value);
  const dataRef = document.getElementById('ep_data').value;

  // Validação básica
  if (isNaN(tmax) || isNaN(tmin) || isNaN(ur) || isNaN(vento) || isNaN(chuva) || isNaN(alt) || !dataRef) {
    alert("Por favor, preencha todos os campos da Estação Própria corretamente.");
    return;
  }

  try {
    const T_med = (tmax + tmin) / 2.0;

    // Calcular Pressão Atmosférica baseada na altitude (Fórmula simplificada FAO)
    const pressao_kpa = 101.3 * Math.pow((293.0 - 0.0065 * alt) / 293.0, 5.26);

    // Latitude local
    const latitude_rad = pyeto.deg2rad(-9.38);

    // Data - Dia do ano
    const refDate = new Date(dataRef);
    const start = new Date(refDate.getFullYear(), 0, 0);
    const dia_ano = Math.floor(((refDate - start) + ((start.getTimezoneOffset() - refDate.getTimezoneOffset()) * 60 * 1000)) / (1000 * 60 * 60 * 24));

    // Radiação Solar Estimada baseada nas temperaturas (Fórmula de Hargreaves-Samani p/ FAO-56 quando falta rad_solar)
    const ra = pyeto.extraterrestrial_rad(dia_ano, latitude_rad);
    // Coeficiente empírico (Krs) comum para regiões costeiras/interior: ~0.16
    const rs_mj = 0.16 * Math.sqrt(Math.abs(tmax - tmin)) * ra;

    // Cálculos PyETo
    const es = pyeto.svp_from_t(tmax) * 0.5 + pyeto.svp_from_t(tmin) * 0.5;
    const ea = pyeto.avp_from_rhmean(pyeto.svp_from_t(tmin), pyeto.svp_from_t(tmax), ur);
    const delta = pyeto.delta_svp(T_med);
    const gama = pyeto.psy_const(pressao_kpa);

    const rso = pyeto.cs_rad(alt, ra);
    const rns = pyeto.net_in_sw_rad(rs_mj);
    const rnl = pyeto.net_out_lw_rad(tmin, tmax, ea, rs_mj, rso);
    const rn = pyeto.net_rad(rns, rnl);

    const eto = pyeto.fao56_penman_monteith(rn, T_med, vento, es, ea, delta, gama);

    const finalEto = isNaN(eto) ? 0 : parseFloat(eto.toFixed(2));
    const finalChuva = parseFloat(chuva.toFixed(2));

    etoDoArquivo = finalEto;
    document.getElementById('eto').value = finalEto;
    document.getElementById('precipitacao').value = finalChuva;

    selectedText.innerHTML = `📡 Estação Própria: ${finalEto} mm/dia`;
    alert("Cálculo realizado com sucesso!");

  } catch (e) {
    console.error("Erro no cálculo Estação Própria:", e);
    alert("Erro ao calcular ETo. Verifique os dados inseridos.");
  }
}

// Função para selecionar a opção ETo
window.selectEtoOption = function (option) {
  etoOptionSelected = option;

  document.getElementById('btnEtoManual').classList.remove('active');
  document.getElementById('btnEtoPropria').classList.remove('active');
  document.getElementById('btnEtoIFSertao').classList.remove('active');

  const manualContainer = document.getElementById('eto-manual-input-container');
  const propriaContainer = document.getElementById('eto-propria-input-container');
  const selectedText = document.getElementById('eto-selected-text');

  if (option === 'manual') {
    document.getElementById('btnEtoManual').classList.add('active');
    selectedText.innerHTML = '✍️ Calcular Manualmente';
    manualContainer.style.display = 'block';
    propriaContainer.style.display = 'none';
  } else if (option === 'propria') {
    document.getElementById('btnEtoPropria').classList.add('active');
    selectedText.innerHTML = '📡 Estação Própria (A preencher)';
    manualContainer.style.display = 'none';
    propriaContainer.style.display = 'block';
  } else if (option === 'ifsertao') {
    document.getElementById('btnEtoIFSertao').classList.add('active');
    manualContainer.style.display = 'none';
    propriaContainer.style.display = 'none';
    calcularEtoIFSertao();
  }

  closeEtoModal();
};
window.openEtoModal = function () {
  // ... (código existente)
  const modal = document.getElementById('eto-bottom-sheet');
  const overlay = document.getElementById('eto-modal-overlay');
  if (modal && overlay) {
    modal.classList.add('open');
    overlay.classList.add('show');
    void overlay.offsetWidth;
    overlay.style.opacity = '1';
  }
};

window.closeEtoModal = function () {
  // ... (código existente)
  const modal = document.getElementById('eto-bottom-sheet');
  const overlay = document.getElementById('eto-modal-overlay');
  if (modal && overlay) {
    modal.classList.remove('open');
    overlay.style.opacity = '0';
    setTimeout(() => {
      overlay.classList.remove('show');
    }, 300);
  }
};

// --- MOTOR DE CÁLCULO (Embrapa + IF Sertão) ---
window.executarCalculoADIM = function () {
  let etoFinal = parseFloat(document.getElementById('eto').value);

  if (etoOptionSelected === 'manual' && (isNaN(etoFinal) || etoFinal <= 0)) {
    alert("Por favor, insira um valor válido para a ETo Manual.");
    return;
  } else if (etoOptionSelected === 'propria' && (isNaN(etoFinal) || etoFinal <= 0)) {
    alert("Por favor, preencha os dados e clique em 'Calcular ETo da Estação' primeiro.");
    return;
  } else if (etoOptionSelected === 'ifsertao' && isNaN(etoFinal)) {
    alert("Aguarde o cálculo automático da estação.");
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

// --- FUNÇÕES DE MEMÓRIA DO TALHÃO (LocalStorage) ---
function carregarTalhoesSalvos() {
  const datalist = document.getElementById('talhoes_salvos');
  if (!datalist) return;

  datalist.innerHTML = ''; // Limpa opções atuais

  const salvosStr = localStorage.getItem('cyberagro_talhoes_v2');
  if (salvosStr) {
    const salvosArr = JSON.parse(salvosStr);
    salvosArr.forEach(talhao => {
      const option = document.createElement('option');
      option.value = talhao;
      datalist.appendChild(option);
    });
  }
}

function salvarNovoTalhao(nomeAInserir) {
  if (!nomeAInserir) return;
  const salvosStr = localStorage.getItem('cyberagro_talhoes_v2');
  let salvosArr = salvosStr ? JSON.parse(salvosStr) : [];

  // Se ainda não existe nesse array local, a gente empurra e salva
  if (!salvosArr.includes(nomeAInserir)) {
    salvosArr.push(nomeAInserir);
    localStorage.setItem('cyberagro_talhoes_v2', JSON.stringify(salvosArr));
    carregarTalhoesSalvos(); // Atualiza o datalist na hora
  }
}

// Inicializa a lista de talhões assim que entra na tela
window.addEventListener('DOMContentLoaded', () => {
  carregarTalhoesSalvos();
});

// --- HELPER: NORMALIZAR TALHÃO ID E GERAR SAFRA ID ---
function normalizarTalhaoId(nome) {
  if (!nome) return "sem_nome";
  return nome.trim().toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/\s+/g, "_") // troca espaços por _
    .replace(/[^a-z0-9_]/g, ""); // remove caracteres especiais
}

function obterSafraIdAtual(talhaoId) {
  const chave = `safra_atual_${talhaoId}`;
  let safraId = localStorage.getItem(chave);
  if (!safraId) {
    // Generate a new one if it doesn't exist yet (e.g. 2026-03-timestamp)
    const data = new Date();
    safraId = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${data.getTime()}`;
    localStorage.setItem(chave, safraId);
  }
  return safraId;
}

function gerarNovaSafraId(talhaoId) {
  const data = new Date();
  const novaSafraId = `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${data.getTime()}`;
  localStorage.setItem(`safra_atual_${talhaoId}`, novaSafraId);
  return novaSafraId;
}

// --- FUNÇÃO PARA SALVAR HISTÓRICO DE IRRIGAÇÃO NO FIREBASE ---
window.salvarHistoricoIrrigacao = async function () {
  const btnSalvar = document.getElementById('btnSalvarIrrigacao');
  const usuarioLogado = auth.currentUser;

  if (!usuarioLogado) {
    alert("Você precisa estar logado para salvar o histórico de irrigação!");
    return;
  }

  // 1. Pegar Identificação
  const nomeTalhao = document.getElementById('nome_talhao').value.trim().toUpperCase();
  if (!nomeTalhao) {
    alert("ERRO IMPORTANTE: Você esqueceu de digitar ou selecionar o 'Nome do Talhão' no topo da calculadora!");
    document.getElementById('nome_talhao').focus();
    return;
  }

  // 2. Pegar Tempo Real x Recomendado
  const tempoRecomendadoStr = document.getElementById('out-tempo').innerText;
  if (tempoRecomendadoStr === "--") {
    alert("Por favor, clique em 'CALCULAR TEMPO' primeiro antes de salvar o histórico da bomba.");
    return;
  }

  const tempoRealStr = document.getElementById('tempo_real').value;
  const tempoRealMinutos = parseInt(tempoRealStr, 10);

  if (isNaN(tempoRealMinutos) || tempoRealMinutos < 0) {
    alert("Informe o 'Tempo Realmente Irrigado (Minutos)' corretamente.");
    document.getElementById('tempo_real').focus();
    return;
  }

  // Converter Tempo Recomendado da tela (ex: "2h 30min") para minutos para facilitar as métricas numéricas na nuvem
  let recomendAcumMinutos = 0;
  if (tempoRecomendadoStr.includes('h')) {
    const partes = tempoRecomendadoStr.split(' ');
    const h = parseInt(partes[0].replace('h', ''), 10) || 0;
    const m = parseInt(partes[1].replace('min', ''), 10) || 0;
    recomendAcumMinutos = (h * 60) + m;
  }

  // Identificadores normalizados
  const talhaoId = normalizarTalhaoId(nomeTalhao);
  const safraId = obterSafraIdAtual(talhaoId);

  // Calcular o volume real efetivamente aplicado (q em L/h e n em qtd)
  const qVazao = parseFloat(document.getElementById('q').value) || 0;
  const nBicos = parseFloat(document.getElementById('n').value) || 0;
  const volRealAplicadoLitros = (tempoRealMinutos / 60) * (qVazao * nBicos);
  const volRecomendadoLitros = parseFloat(document.getElementById('out-vol').innerText.replace(' L', '')) || 0;

  // 3. Empacotar todos os dados agronômicos para cálculo futuro do IEH, IRE e IAF
  const faseFenologicaVal = document.getElementById('fase_cultura').value || "vegetativo";
  const payloadHistorico = {
    userId: usuarioLogado.uid,
    userEmail: usuarioLogado.email,
    talhao: nomeTalhao,            // Nome legível
    nome_talhao: nomeTalhao,       // Legacy compat
    talhaoId: talhaoId,            // Chave padronizada
    safraId: safraId,              // Ciclo atual
    fase_fenologica: faseFenologicaVal,
    tempo_recomendado_minutos: recomendAcumMinutos,
    tempo_realizado_minutos: tempoRealMinutos,
    volume_aplicado_litros: parseFloat(volRealAplicadoLitros.toFixed(2)),
    createdAt: serverTimestamp(),
    dataRegistro: serverTimestamp(),
    clima: {
      fonte_eto: etoOptionSelected,
      eto_mm_dia: parseFloat(document.getElementById('eto').value) || 0,
      chuva_24h_mm: parseFloat(document.getElementById('precipitacao').value) || 0
    },
    planta: {
      fase_fenologica: faseFenologicaVal, // 'vegetativo', 'inducao', 'producao', 'pos_colheita'
      fase_descricao: document.getElementById('out-fase-desc').innerText,
      kc_calculado: parseFloat(document.getElementById('out-kc').innerText) || 0
    },
    sistema_hidraulico: {
      volume_recomendado_planta_litros: parseFloat(volRecomendadoLitros.toFixed(2)),
      volume_real_aplicado_litros: parseFloat(volRealAplicadoLitros.toFixed(2)),
      vazao_bico_lh: qVazao,
      qtd_bicos_planta: nBicos
    },
    balanco_hidrico: {
      tempo_recomendado_minutos: recomendAcumMinutos,
      tempo_real_acionado_minutos: tempoRealMinutos
    }
  };

  try {
    btnSalvar.innerText = "⏳ SALVANDO NA NUVEM...";
    btnSalvar.disabled = true;

    // Enviar pro Firebase "historico_irrigacoes"
    const docRef = await addDoc(collection(db, "historico_irrigacoes"), payloadHistorico);
    console.log("Documento de irrigação salvo com sucesso. ID:", docRef.id);

    // MEMÓRIA LOCAL: Salva o novo nome do talhão para o autocomplete futuro
    salvarNovoTalhao(nomeTalhao);
    localStorage.setItem("boletim_talhao_atual", nomeTalhao);

    // Feedback visual de sucesso!
    btnSalvar.style.backgroundColor = "#1b5e20";
    btnSalvar.innerText = "✔️ HISTÓRICO SALVO COM SUCESSO!";

    setTimeout(() => {
      btnSalvar.style.backgroundColor = "#2E7D32";
      btnSalvar.innerText = "CONFIRMAR E SALVAR IRRIGAÇÃO";
      btnSalvar.disabled = false;

      // Limpeza de todos os campos da Calculadora
      document.getElementById('nome_talhao').value = "";
      document.getElementById('eto').value = "";
      document.getElementById('ep_tmax').value = "";
      document.getElementById('ep_tmin').value = "";
      document.getElementById('ep_ur').value = "";
      document.getElementById('ep_vento').value = "";
      document.getElementById('ep_chuva').value = "";
      document.getElementById('ep_data').value = "";
      document.getElementById('precipitacao').value = "0";
      document.getElementById('fase_cultura').value = "vegetativo";
      document.getElementById('data_florada').value = "";
      document.getElementById('ep').value = "";
      document.getElementById('el').value = "";
      document.getElementById('q').value = "";
      document.getElementById('n').value = "1";
      document.getElementById('tempo_real').value = "";

      // Reseta a Seleção de ETo para o Manual
      selectEtoOption('manual');

      // Esconde o painel de resultados e limpa
      document.getElementById('adim-results').style.display = 'none';
      document.getElementById('fase-feedback').style.display = 'none';
      document.getElementById('out-tempo').innerText = "--";
      document.getElementById('out-vol').innerText = "-";
      document.getElementById('out-fase-desc').innerText = "-";
      document.getElementById('out-kc').innerText = "-";
      document.getElementById('out-eto-usada').innerText = "-";

    }, 4000);

  } catch (error) {
    console.error("Erro ao salvar histórico de irrigação:", error);
    alert(`Erro ao salvar na nuvem: ${error.message}`);
    btnSalvar.innerText = "CONFIRMAR E SALVAR IRRIGAÇÃO";
    btnSalvar.disabled = false;
  }
}

// --- MOTOR DE ÍNDICES PROPRIETÁRIOS E FECHAMENTO DE SAFRA ---
window.fecharSafra = async function () {
  const usuarioLogado = auth.currentUser;
  if (!usuarioLogado) {
    alert("Você precisa estar logado para gerar o fechamento de safra.");
    return;
  }

  const talhao = document.getElementById('fecha_talhao').value.trim().toUpperCase();
  const pesoKgStr = document.getElementById('fecha_peso_kg').value;
  const pesoKg = parseFloat(pesoKgStr);

  if (!talhao) {
    alert("Informe o Nome do Talhão que deseja fechar.");
    document.getElementById('fecha_talhao').focus();
    return;
  }
  if (!pesoKg || pesoKg <= 0) {
    alert("Informe o Peso Total Colhido (Kg) para o cálculo do Índice de Eficiência Hídrica.");
    document.getElementById('fecha_peso_kg').focus();
    return;
  }

  const talhaoId = normalizarTalhaoId(talhao);
  const safraId = obterSafraIdAtual(talhaoId);

  const btnFechar = document.getElementById('btnFecharSafra');
  btnFechar.innerText = "⏳ BAIXANDO HISTÓRICO E CALCULANDO...";
  btnFechar.disabled = true;

  try {
    // 1. Baixar histórico de irrigação do talhão
    const historicoRef = collection(db, "historico_irrigacoes");

    // Removemos a exigência estrita de safraId na busca para permitir que irrigações antigas (legacy) 
    // ou recém-criadas que falharam ao anexar a safra sejam computadas no fechamento deste Talhão.
    const q = query(historicoRef, where("userId", "==", usuarioLogado.uid), where("talhaoId", "==", talhaoId));
    const querySnapshot = await getDocs(q);

    if (querySnapshot.empty) {
      alert(`Nenhum registro de irrigação encontrado para "${talhao}" calcular os índices.`);
      btnFechar.innerText = "ENCERRAR CICLO E GERAR ÍNDICES";
      btnFechar.disabled = false;
      return;
    }

    let volumeTotalAplicadoLitros = 0;

    // Contadores para o Índice de Risco de Estresse (IRE) na fase de produção(enchimento)
    let totalDiasProducao = 0;
    let diasComEstresse = 0;

    // Contadores para o Índice de Adequação Fenológica (IAF) na fase de indução (PBZ)
    let totalDiasInducao = 0;
    let diasComAdequacao = 0;

    querySnapshot.forEach((doc) => {
      const data = doc.data();

      // Cálculo do volume (vReal)  
      let vReal = data.sistema_hidraulico?.volume_real_aplicado_litros;
      const vRecomendado = data.sistema_hidraulico?.volume_recomendado_planta_litros || 0;
      const tRecomendado = data.balanco_hidrico?.tempo_recomendado_minutos || 0;
      const tReal = data.balanco_hidrico?.tempo_real_acionado_minutos || 0;

      if (typeof vReal === 'undefined') {
        if (tRecomendado > 0) {
          vReal = vRecomendado * (tReal / tRecomendado);
        } else if (tReal > 0 && tRecomendado === 0) {
          const vazao = data.sistema_hidraulico?.vazao_bico_lh || 0;
          const bicos = data.sistema_hidraulico?.qtd_bicos_planta || 0;
          vReal = vazao * bicos * (tReal / 60);
        } else {
          vReal = 0;
        }
      }

      // REGRA 1: Somatório para o IEH
      volumeTotalAplicadoLitros += vReal;

      const fase = data.planta?.fase_fenologica;

      // REGRA 2: Punição do IRE na fase Produção (Enchimento)
      if (fase === 'producao') {
        totalDiasProducao++;
        if (vReal < (vRecomendado * 0.8)) {
          diasComEstresse++;
        }
      }

      // REGRA 3: Premiação do IAF na fase Indução (PBZ)
      if (fase === 'inducao') {
        totalDiasInducao++;
        if (vReal <= (vRecomendado * 0.5)) {
          diasComAdequacao++;
        }
      }
    });

    // 2. MATEMÁTICA DOS ÍNDICES

    // a) Índice de Eficiência Hídrica (IEH)
    let ieh = 0;
    let corIeh = '#0288d1';
    if (pesoKg > 0) {
      ieh = volumeTotalAplicadoLitros / pesoKg;
      corIeh = ieh <= 200 ? '#0288d1' : '#c2185b'; // Azul ou Vermelho
    } else {
      ieh = 0; // Trava contra Infinity/Null
    }

    // b) Índice de Risco de Estresse (IRE): Quanto menor, melhor (ideal 0%)
    let ire = 0;
    if (totalDiasProducao > 0) {
      ire = (diasComEstresse / totalDiasProducao) * 100;
    }

    // c) Índice de Adequação Fenológica (IAF): Quanto maior, melhor (ideal 100%)
    let iaf = 0;
    if (totalDiasInducao > 0) {
      iaf = (diasComAdequacao / totalDiasInducao) * 100;
    }

    // d) SCORE GLOBAL (0 a 100)
    let notaIEH = 100;
    if (ieh > 150) {
      notaIEH -= (ieh - 150) * 0.5; // Reduz gradativamente
      if (notaIEH < 0) notaIEH = 0;
    }

    // Matemática Reversa pro Risco (IRE) e direta pra Adequação (IAF)
    let notaIRE = 100 - ire;
    let notaIAF = iaf;

    // Consolidação 40/30/30
    let preScore = (notaIEH * 0.4) + (notaIRE * 0.3) + (notaIAF * 0.3);

    // Trava de blindagem exigida:
    let scoreFinal = Math.max(0, Math.min(100, preScore));

    // AUDITORIA NO CONSOLE PARA INSPEÇÃO
    console.log("=== AUDITORIA DE FECHAMENTO (FECHAR SAFRA) ===");
    console.log(`Variável Talhão: "${talhao}" | Peso: ${pesoKg} Kg`);
    console.log(`[IEH] Volume Lido: ${volumeTotalAplicadoLitros.toFixed(2)} L | Divisão IEH: ${ieh.toFixed(1)} L/Kg`);
    console.log(`[IRE] Dias de Produção: ${totalDiasProducao} | Dias Violados (<80%): ${diasComEstresse} | IRE Calculado: ${ire.toFixed(1)}%`);
    console.log(`[IAF] Dias de Indução: ${totalDiasInducao} | Dias Respeitados (<=50%): ${diasComAdequacao} | IAF Calculado: ${iaf.toFixed(1)}%`);
    console.log(`[SCORE] Nota IEH: ${notaIEH.toFixed(2)} | Nota IRE: ${notaIRE.toFixed(2)} | Nota IAF: ${notaIAF.toFixed(2)} | Score Final Travado: ${scoreFinal.toFixed(1)}`);
    console.log("=================================================");

    // 3. RENDERIZAÇÃO NA TELA
    document.getElementById('res_ieh').innerText = `${ieh.toFixed(1)}`;
    document.getElementById('res_ieh').style.color = corIeh;

    document.getElementById('res_ire').innerText = `${ire.toFixed(1)}%`;
    document.getElementById('res_ire').style.color = ire > 20 ? '#bf360c' : '#33691e'; // Vermelho se > 20% estresse

    document.getElementById('res_iaf').innerText = `${iaf.toFixed(1)}%`;
    document.getElementById('res_iaf').style.color = iaf > 70 ? '#33691e' : '#f57f17'; // Verde se > 70% adequado

    document.getElementById('res_score').innerText = `${Math.round(scoreFinal)}`;
    if (scoreFinal > 80) document.getElementById('res_score').style.color = '#33691e'; // Verde
    else if (scoreFinal > 60) document.getElementById('res_score').style.color = '#f57f17'; // Laranja
    else document.getElementById('res_score').style.color = '#bf360c'; // Vermelho

    // MEMÓRIA LOCAL DO TALHÃO PRO FECHAMENTO TBM E AUTO-FILL
    salvarNovoTalhao(talhao);
    document.getElementById('nome_talhao').value = talhao; // Joga o nome pra calculadora de irrigação

    // Limpa a tela de colheita
    document.getElementById('fecha_talhao').value = "";
    document.getElementById('fecha_mangas_ia').value = "";
    document.getElementById('fecha_peso_kg').value = "";

    // Salvar registro de fechamento no Firestore
    const payloadFechamento = {
      userId: usuarioLogado.uid,
      talhaoId: talhaoId,
      nome_talhao: talhao,
      safraId: safraId,
      peso_total_colhido_kg: pesoKg,
      volume_total_safra_litros: volumeTotalAplicadoLitros,
      ieh_final: ieh,
      ire_final: ire,
      iaf_final: iaf,
      score_final: scoreFinal,
      createdAt: serverTimestamp()
    };
    await addDoc(collection(db, "fechamentos_safra"), payloadFechamento);

    // Gerar NOVO Safra ID, porque essa encerrou
    gerarNovaSafraId(talhaoId);

    window.mostrarBoletimNaAbaIrrigacao({ nomeTalhao: talhao, safraId: safraId });
    window.escutarUltimasIrrigacoes(db, talhaoId, usuarioLogado.uid, 10);

    btnFechar.innerText = "ENCERRAR CICLO E GERAR ÍNDICES";
    btnFechar.disabled = false;

    // Faz scroll suave até o boletim final
    setTimeout(() => {
      const container = document.getElementById('container-indices-resultado');
      if (container) {
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 100);

  } catch (error) {
    console.error("Erro no motor de índices:", error);
    alert("Falha ao processar os índices: " + error.message);
    btnFechar.innerText = "ENCERRAR CICLO E GERAR ÍNDICES";
    btnFechar.disabled = false;
  }
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
    const telas = [loginScreen, registerScreen, selecaoCulturaScreen, dashboardScreen, irrigacaoScreen, chatScreen];
    telas.forEach(s => { if (s) s.classList.add('hide'); });

    // Mostra a tela desejada
    const telaAtual = document.getElementById(telaId);
    telaAtual.classList.remove('hide');
    telaAtual.style.display = (telaId === 'chat-screen' || telaId === 'dashboard-screen') ? 'flex' : 'block';

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

        window.escutarHistoricoFechamentos(db, userCredential.user.uid, 50);

        // Se a aba de irrigação já estiver ativa e houver talhao no cache local
        setTimeout(() => {
          if (document.getElementById('tabIrrigacao')?.classList.contains('active')) {
            onEnterHomeIrrigacaoTab();
          }
        }, 500);
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
      console.log("Usuário já está logado:", user.email);

      // Garante que a primeira aba (Produtividade) receba as safras preenchidas no boot
      window.escutarHistoricoFechamentos(db, user.uid, 50);

      // Opcionalmente auto-carrega histórico se ele já estiver na tela de dashboard > irrigação
      if (document.getElementById('dashboard-screen')?.style.display !== 'none' || !document.getElementById('dashboard-screen')?.classList.contains('hide')) {
        setTimeout(() => {
          if (document.getElementById('tabIrrigacao')?.classList.contains('active')) {
            onEnterHomeIrrigacaoTab();
          }
        }, 500);
      }
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
  // LÓGICA DA SIDEBAR DE PERFIL
  // ===============================
  window.openSidebar = function () {
    const sidebar = document.getElementById('perfil-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
      sidebar.classList.add('open');
      overlay.classList.add('show');
      // trigger reflow para animação do opacity
      void overlay.offsetWidth;
      overlay.style.opacity = '1';
    }
  };

  window.closeSidebar = function () {
    const sidebar = document.getElementById('perfil-sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    if (sidebar && overlay) {
      sidebar.classList.remove('open');
      overlay.style.opacity = '0';
      setTimeout(() => {
        overlay.classList.remove('show');
      }, 300);
    }
  };

  // ===============================
  // LÓGICA DE ABAS (PRODUTIVIDADE / IRRIGAÇÃO)
  // ===============================
  window.switchHomeTab = function (index) {
    const container = document.getElementById('homeSwipeContainer');
    if (container) {
      const width = container.clientWidth;
      container.scrollTo({ left: width * index, behavior: 'smooth' });
    }

    if (index === 0 && auth.currentUser) {
      window.escutarHistoricoFechamentos(db, auth.currentUser.uid, 50);
    }

    // Also trigger manually if css scroll snap doesn't fire the event fast enough
    if (index === 1) {
      onEnterHomeIrrigacaoTab();
    }
  };

  window.handleHomeScroll = function () {
    const container = document.getElementById('homeSwipeContainer');
    if (!container) return;
    const tabProdutividade = document.getElementById('tabProdutividade');
    const tabIrrigacao = document.getElementById('tabIrrigacao');

    const index = Math.round(container.scrollLeft / container.clientWidth);

    if (index === 0) {
      if (tabProdutividade) tabProdutividade.classList.add('active');
      if (tabIrrigacao) tabIrrigacao.classList.remove('active');

      // Carrega histórico de fechamentos sempre que volta pra cá
      if (auth.currentUser) window.escutarHistoricoFechamentos(db, auth.currentUser.uid, 50);

    } else {
      if (tabProdutividade) tabProdutividade.classList.remove('active');
      if (tabIrrigacao) tabIrrigacao.classList.add('active');
      onEnterHomeIrrigacaoTab();
    }
  };

  window.mostrarBoletimNaAbaIrrigacao = async function ({ nomeTalhao, safraId }) {
    // Definimos o contexto global de inicialização (Boot do Talhão)
    const tId = normalizarTalhaoId(nomeTalhao);

    // Atualiza o rastreio
    localStorage.setItem("boletim_talhaoId_atual", tId);
    localStorage.setItem("boletim_talhaoNome_atual", nomeTalhao || "");

    // Fallback velhos pro caso de algo mais usar
    localStorage.setItem("boletim_talhao_atual", nomeTalhao || "");
    localStorage.setItem("boletim_safra_atual", safraId || "");

    if (safraId) {
      localStorage.setItem("boletim_safraId_atual", safraId);
    } else {
      localStorage.removeItem("boletim_safraId_atual");
    }

    // Navega
    nav('dashboard-screen');
    window.switchHomeTab(1);

    // O switch já dispara o onEnter, mas garantimos
    await onEnterHomeIrrigacaoTab();
  };

  function renderHistoricoIrrigacao(registros) {
    const list = document.getElementById('historico-irrigacao-list');
    const empty = document.getElementById('historico-irrigacao-empty');

    list.innerHTML = '';

    if (!registros || registros.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    registros.forEach(r => {
      // Compatibilidade com dataRegistro (antiga) ou createdAt (nova)
      const validDate = r.createdAt || r.dataRegistro;
      const dt = validDate?.toDate ? validDate.toDate() : null;
      const dataFmt = dt
        ? dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        : '—';

      const faseFenologica = r.planta?.fase_fenologica || r.fase_fenologica || '-';
      const tempoRecomendado = r.balanco_hidrico?.tempo_recomendado_minutos ?? r.tempo_recomendado_minutos ?? '-';
      const tempoReal = r.balanco_hidrico?.tempo_real_acionado_minutos ?? r.tempo_realizado_minutos ?? '-';
      const volAplicado = r.sistema_hidraulico?.volume_recomendado_planta_litros ?? r.volume_aplicado_litros ?? '-';
      const nTalhao = r.talhao || r.nome_talhao || '-';

      const card = document.createElement('div');
      card.style.cssText = `
        border:1px solid #eee; border-radius:12px; padding:12px;
        background:#fff; box-shadow: 0 2px 6px rgba(0,0,0,.04);
      `;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <div style="font-weight:700; color:#2e7d32;">${dataFmt}</div>
          <div style="font-size:.85rem; color:#666; text-transform:uppercase;">${faseFenologica}</div>
        </div>
  
        <div style="margin-top:8px; display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:.9rem;">
          <div><span style="color:#777;">Recomendado:</span> <b>${tempoRecomendado}</b> min</div>
          <div><span style="color:#777;">Real:</span> <b>${tempoReal}</b> min</div>
          <div><span style="color:#777;">Volume/Planta:</span> <b>${volAplicado}</b> L</div>
          <div><span style="color:#777;">Talhão:</span> <b>${nTalhao}</b></div>
        </div>
      `;

      list.appendChild(card);
    });
  }

  let unsubscribeHistorico = null;
  window.escutarUltimasIrrigacoes = function (dbInstance, talhaoIdParam, userId, limitN = 10) {
    if (unsubscribeHistorico) unsubscribeHistorico();

    const ref = collection(dbInstance, "historico_irrigacoes");

    // Agora usando a chave padronizada talhaoId
    const qFiltro = query(
      ref,
      where("userId", "==", userId),
      where("talhaoId", "==", talhaoIdParam),
      orderBy("createdAt", "desc"),
      limit(limitN)
    );

    unsubscribeHistorico = onSnapshot(qFiltro, (snap) => {
      const registros = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      console.log(`[DEBUG AUDITORIA] quantidade de irrigações no snapshot: ${registros.length}`);
      renderHistoricoIrrigacao(registros);
    }, (err) => {
      console.error("Erro histórico irrigação:", err);
      // Fallback pra order by dataRegistro caso 'createdAt' nao exista em docs velhos,
      // mas como o onSnapshot lida bem com docs sem campo (omitindo-os), só logamos.
    });
  };

  // --- RENDERS E LISTENERS HISTORICO DE FECHAMENTOS (COLHEITAS) ---
  function renderHistoricoFechamentos(items) {
    const list = document.getElementById('fechamentos-list');
    const empty = document.getElementById('fechamentos-empty');

    if (!list || !empty) return;

    list.innerHTML = '';

    if (!items || items.length === 0) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    items.forEach(x => {
      const dt = x.createdAt?.toDate ? x.createdAt.toDate() : null;
      const dataFmt = dt
        ? dt.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        : '—';

      const card = document.createElement('div');
      card.style.cssText = `
        border:1px solid #eee; border-radius:12px; padding:12px;
        background:#fff; box-shadow: 0 2px 6px rgba(0,0,0,.04);
      `;

      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; gap:10px;">
          <div style="font-weight:700; color:#F57F17;">${dataFmt}</div>
          <div style="font-size:.85rem; color:#666;">${x.safraId ? `Safra: ${x.safraId}` : 'Safra: —'}</div>
        </div>
  
        <div style="margin-top:8px; display:grid; grid-template-columns: 1fr 1fr; gap:8px; font-size:.95rem;">
          <div><span style="color:#777;">Talhão:</span> <b>${x.nome_talhao ?? '-'}</b></div>
          <div><span style="color:#777;">Peso:</span> <b>${x.peso_total_colhido_kg ?? '-'}</b> kg</div>
          <div><span style="color:#777;">IA (Qtd):</span> <b>${x.qtd_mangas_ia ?? '-'}</b></div>
          <div><span style="color:#777;">Score:</span> <b>${x.score_final ?? '-'}</b></div>
        </div>
      `;

      list.appendChild(card);
    });
  }

  let unsubscribeFechamentos = null;
  window.escutarHistoricoFechamentos = function (dbInstance, userId, limitN = 50) {
    if (unsubscribeFechamentos) unsubscribeFechamentos();

    const elFiltroTalhao = document.getElementById('filtro-historico-talhao');
    const elFiltroPeriodo = document.getElementById('filtro-historico-periodo');

    const selectedTalhao = elFiltroTalhao ? elFiltroTalhao.value : "TODOS";
    const selectedPeriodo = elFiltroPeriodo ? elFiltroPeriodo.value : "ALL";

    const refCol = collection(dbInstance, "fechamentos_safra");

    // Constrói a Query Base
    let condicoes = [where("userId", "==", userId)];

    if (selectedTalhao !== "TODOS") {
      condicoes.push(where("talhaoId", "==", selectedTalhao));
    }

    if (selectedPeriodo !== "ALL") {
      const dias = parseInt(selectedPeriodo);
      const dataLimite = new Date();
      dataLimite.setDate(dataLimite.getDate() - dias);
      condicoes.push(where("createdAt", ">=", dataLimite));
    }

    // Aplica as ordens
    condicoes.push(orderBy("createdAt", "desc"));
    condicoes.push(limit(limitN));

    const q = query(refCol, ...condicoes);

    unsubscribeFechamentos = onSnapshot(q, async (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      renderHistoricoFechamentos(items);

      // (Re)popula o select de Filtro de Talhão com as opções exclusivas
      if (elFiltroTalhao && elFiltroTalhao.length <= 1) { // Só popula se estiver zerado (Só tem o "TODOS")
        try {
          const qAll = query(collection(dbInstance, "fechamentos_safra"), where("userId", "==", userId));
          const snapAll = await getDocs(qAll);

          const uniqueTalhoes = new Map();
          snapAll.docs.forEach(doc => {
            const data = doc.data();
            if (data.talhaoId && data.nome_talhao) {
              uniqueTalhoes.set(data.talhaoId, data.nome_talhao);
            }
          });

          uniqueTalhoes.forEach((nome, tId) => {
            const opt = document.createElement('option');
            opt.value = tId;
            opt.textContent = nome;
            if (opt.value === selectedTalhao) opt.selected = true;
            elFiltroTalhao.appendChild(opt);
          });

          // Liga os eventListeners
          if (!elFiltroTalhao.dataset.listener) {
            elFiltroTalhao.dataset.listener = "true";
            elFiltroTalhao.addEventListener('change', () => window.escutarHistoricoFechamentos(dbInstance, userId, limitN));
            if (elFiltroPeriodo) elFiltroPeriodo.addEventListener('change', () => window.escutarHistoricoFechamentos(dbInstance, userId, limitN));
          }
        } catch (e) { }
      }

    }, (err) => {
      console.error("Erro histórico fechamentos:", err);
    });
  };

  async function carregarUltimoFechamento(dbInstance, userId) {
    const ref = collection(dbInstance, "fechamentos_safra");
    const q = query(
      ref,
      where("userId", "==", userId),
      orderBy("createdAt", "desc"),
      limit(1)
    );

    const snap = await getDocs(q);
    if (snap.empty) return null;

    return { id: snap.docs[0].id, ...snap.docs[0].data() };
  }

  // Busca de forma abrangente os talhões que o usuário já interagiu para montar os selections
  async function buscarTodosTalhoesUsuario(dbInstance, userId) {
    const talhoesSet = new Set();

    // 1) Memória Local
    try {
      const savedStr = localStorage.getItem("cyberagro_talhoes_v2");
      if (savedStr) {
        JSON.parse(savedStr).forEach(t => { if (t) talhoesSet.add(t); });
      }
    } catch (e) { }

    // 2) Safras Fechadas no passado
    try {
      const qF = query(collection(dbInstance, "fechamentos_safra"), where("userId", "==", userId));
      const snapF = await getDocs(qF);
      snapF.forEach(doc => {
        const dt = doc.data();
        if (dt.nome_talhao) talhoesSet.add(dt.nome_talhao);
        if (dt.talhao) talhoesSet.add(dt.talhao);
      });
    } catch (e) { }

    // 3) Irrigações soltas recentes
    try {
      const qI = query(collection(dbInstance, "historico_irrigacoes"), where("userId", "==", userId), orderBy("createdAt", "desc"), limit(50));
      const snapI = await getDocs(qI);
      snapI.forEach(doc => {
        const dt = doc.data();
        if (dt.nome_talhao) talhoesSet.add(dt.nome_talhao);
        if (dt.talhao) talhoesSet.add(dt.talhao);
      });
    } catch (e) { }

    return Array.from(talhoesSet).sort();
  }

  async function onEnterHomeIrrigacaoTab(forcaTalhaoId = null) {
    const userId = auth.currentUser?.uid;
    if (!userId) return;

    // 1) Descobre todos os talhões do usuário para popular o select
    const allTalhoesNomes = await buscarTodosTalhoesUsuario(db, userId);
    const selectTalhao = document.getElementById('boletim-talhao-select');
    const containerIndices = document.getElementById('container-indices-resultado');
    const bSafra = document.getElementById('boletim-safra');
    const emptyHistorico = document.getElementById('historico-irrigacao-empty');
    const listHistorico = document.getElementById('historico-irrigacao-list');

    if (!allTalhoesNomes || allTalhoesNomes.length === 0) {
      if (containerIndices) containerIndices.style.display = 'none';
      if (emptyHistorico) {
        emptyHistorico.style.display = 'block';
        emptyHistorico.textContent = 'Você ainda não possui histórico agrícola para exibir no Boletim.';
      }
      if (listHistorico) listHistorico.innerHTML = '';
      return;
    }

    if (containerIndices) containerIndices.style.display = 'block';

    // Converte Nomes para Array de Objetos { id, nome } garantindo unicidade
    let opcoes = allTalhoesNomes.map(nome => ({ id: normalizarTalhaoId(nome), nome: nome }));

    // 2) Define qual talhão carregar (ou forçado pelo select, ou o último fechamento global)
    let alvoTalhaoId = forcaTalhaoId;

    if (!alvoTalhaoId) {
      const lastFechamentoGeral = await carregarUltimoFechamento(db, userId);
      if (lastFechamentoGeral && lastFechamentoGeral.talhaoId) {
        alvoTalhaoId = lastFechamentoGeral.talhaoId;
      } else {
        alvoTalhaoId = opcoes[0].id; // Fallback
      }
    }

    // 3) Popula Select (Garantindo que não duplica listeners)
    if (selectTalhao) {
      selectTalhao.innerHTML = '';
      opcoes.forEach(op => {
        const o = document.createElement('option');
        o.value = op.id;
        o.textContent = op.nome;
        if (op.id === alvoTalhaoId) o.selected = true;
        selectTalhao.appendChild(o);
      });

      if (!selectTalhao.dataset.listener) {
        selectTalhao.dataset.listener = "true";
        selectTalhao.addEventListener('change', (e) => {
          onEnterHomeIrrigacaoTab(e.target.value);
        });
      }
    }

    console.log(`[DEBUG AUDITORIA] talhaoId selecionado: ${alvoTalhaoId}`);

    // 4) Carregar Boletim e Renderizar
    const fechamento = await carregarBoletimTalhao(db, userId, alvoTalhaoId);
    renderizarBoletim(fechamento);

    // 5) Engata o hook do Histórico visual daquele talhão alvo (tempo real)
    carregarHistoricoTalhao(db, alvoTalhaoId, userId);
  }

  // ETAPA 2 - Separação de Responsabilidades: Boletim x Historico
  async function carregarBoletimTalhao(dbInstance, userId, talhaoId) {
    try {
      const refCol = collection(dbInstance, "fechamentos_safra");
      const q = query(refCol, where("userId", "==", userId), where("talhaoId", "==", talhaoId), orderBy("createdAt", "desc"), limit(1));
      const snap = await getDocs(q);

      if (snap.empty) {
        console.log(`[DEBUG AUDITORIA] Nenhum fechamento encontrado para o talhão: ${talhaoId}`);
        return null;
      }

      const doc = snap.docs[0];
      const data = doc.data();
      console.log(`[DEBUG AUDITORIA] fechamento encontrado (doc.id: ${doc.id}, talhaoId: ${data.talhaoId}, safraId: ${data.safraId || 'N/A'})`);

      return data;
    } catch (err) {
      console.warn("Erro ao buscar KPIs:", err);
      return { error: err.message };
    }
  }

  function renderizarBoletim(fechamento) {
    const elIeh = document.getElementById('res_ieh');
    const elIre = document.getElementById('res_ire');
    const elIaf = document.getElementById('res_iaf');
    const elScore = document.getElementById('res_score');
    const bSafra = document.getElementById('boletim-safra');

    // Se NÃO tem fechamento, a regra é exibir "Nenhum boletim" (Não recalcular)
    if (!fechamento || fechamento.error) {
      if (bSafra) {
        if (fechamento?.error && fechamento.error.includes("index")) {
          bSafra.innerHTML = `<span style="color:red;font-size:10px;">FIREBASE INDEX ERROR: ${fechamento.error}</span>`;
        } else {
          bSafra.innerHTML = "<span style='color:#e65100; font-weight:bold;'>Nenhum boletim disponível. Faça um fechamento de safra.</span>";
        }
      }
      if (elIeh) { elIeh.innerHTML = `<strong>—</strong>`; elIeh.style.color = "#01579b"; }
      if (elIre) { elIre.innerHTML = `<strong>—</strong>`; elIre.style.color = "#bf360c"; }
      if (elIaf) { elIaf.innerHTML = `<strong>—</strong>`; elIaf.style.color = "#33691e"; }
      if (elScore) { elScore.innerHTML = `<strong>—</strong>`; elScore.style.color = "#e65100"; }
      return;
    }

    // Se TEM fechamento, usa apenas os dados consolidados dele (ETAPA 1 e 3)
    if (bSafra) bSafra.textContent = `SafraID (Ref): ${fechamento.safraId || 'Desconhecida'}`;

    if (elIeh) {
      const val = fechamento.ieh_final;
      elIeh.innerHTML = `<strong>${val !== undefined ? val.toFixed(1) : '—'}</strong>`;
      elIeh.style.color = (val <= 200) ? '#0288d1' : '#c2185b';
    }
    if (elIre) {
      const val = fechamento.ire_final;
      elIre.innerHTML = `<strong>${val !== undefined ? val.toFixed(1) + '%' : '—'}</strong>`;
      elIre.style.color = (val > 20) ? '#bf360c' : '#33691e';
    }
    if (elIaf) {
      const val = fechamento.iaf_final;
      elIaf.innerHTML = `<strong>${val !== undefined ? val.toFixed(1) + '%' : '—'}</strong>`;
      elIaf.style.color = (val > 70) ? '#33691e' : '#f57f17';
    }
    if (elScore) {
      const val = fechamento.score_final;
      elScore.innerHTML = `<strong>${val !== undefined ? Math.round(val) : '—'}</strong>`;
      if (val > 80) elScore.style.color = '#33691e';
      else if (val > 60) elScore.style.color = '#f57f17';
      else elScore.style.color = '#bf360c';
    }
  }

  function carregarHistoricoTalhao(dbInstance, talhaoId, userId) {
    // Busca apenas irrigacao e popula lista.
    window.escutarUltimasIrrigacoes(dbInstance, talhaoId, userId, 10);
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

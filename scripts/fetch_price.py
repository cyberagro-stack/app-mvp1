import gspread
import json
import os
import time
import re # <-- Importa a biblioteca de "limpeza" (Regex)

# --- CONFIGURAÇÃO ---
NOME_DA_TABELA = "CyberAgro_Precos"
NOME_DA_ABA = "Sheet1" # (Nome padrão que corrigimos)
PRODUTO_ALVO = "Tommy - produtor" # (O seu produto correto)
PESO_MEDIO_FALLBACK = 500
JSON_PATH = "mango_prices.json"
# --------------------

try:
    # Este passo agora deve funcionar (graças ao Passo 1)
    key_content = os.environ.get('GCP_SA_KEY')
    if not key_content:
        raise ValueError("Secret GCP_SA_KEY não encontrado.")
    
    with open("gcp_key.json", "w") as f:
        f.write(key_content)
    
    gc = gspread.service_account(filename="gcp_key.json")
    print("Autenticação com Google Sheets bem-sucedida.")

    sh = gc.open(NOME_DA_TABELA)
    worksheet = sh.worksheet(NOME_DA_ABA)
    
    print(f"A ler a tabela '{NOME_DA_TABELA}' (Aba: {NOME_DA_ABA})...")
    
    lista_de_registos = worksheet.get_all_records()
    if not lista_de_registos:
        raise ValueError("Nenhum dado encontrado na tabela.")
        
    dados_manga = None
    for registo in reversed(lista_de_registos): 
        if registo.get('Produto') and registo['Produto'].strip() == PRODUTO_ALVO:
            dados_manga = registo
            break 
            
    if not dados_manga:
        raise ValueError(f"Produto '{PRODUTO_ALVO}' não encontrado na tabela.")

    if 'Preço' not in dados_manga:
        raise ValueError("Coluna 'Preço' em falta na tabela.")

    # --- CORREÇÃO DE LIMPEZA DE STRING (v2.18) ---
    # Pega a string do preço (ex: "R$ 1,86")
    preco_str = str(dados_manga.get('Preço', 0))
    
    # Apaga TUDO o que não for um dígito (0-9) ou uma vírgula (,)
    preco_limpo_str = re.sub(r'[^\d,]', '', preco_str)
    
    # Troca a vírgula por ponto (ex: "1,86" -> "1.86") e converte para float
    preco_limpo = float(preco_limpo_str.replace(",", "."))
    # ------------------------------------------------

    peso_limpo = int(dados_manga.get('Peso_Medio_G', PESO_MEDIO_FALLBACK))
    data_str = f"{dados_manga.get('Dia')}/{dados_manga.get('Mês')}/{dados_manga.get('Ano')}"

    novos_dados = {
        "preco_kg": preco_limpo,
        "peso_medio_g": peso_limpo,
        "fonte": dados_manga.get('Região', 'Google Sheets') + f" ({data_str})",
        "ultima_atualizacao": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    if preco_limpo == 0:
        print("Aviso: O preço limpo extraído da tabela foi 0.")
        
    print(f"Dados encontrados: {PRODUTO_ALVO} - Preço R${novos_dados['preco_kg']}, Peso {novos_dados['peso_medio_g']}g")
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(novos_dados, f, indent=2, ensure_ascii=False)
    print("Ficheiro mango_prices.json atualizado com sucesso.")

except Exception as e:
    print(f"Erro fatal: {e}")
    # Se falhar, grava um JSON com preço 0
    fallback_data = { "preco_kg": 0, "peso_medio_g": 500, "fonte": f"Erro ao ler GSheet: {e}", "ultima_atualizacao": "N/A" }
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(fallback_data, f, indent=2, ensure_ascii=False)
    raise e
finally:
    if os.path.exists("gcp_key.json"):
        os.remove("gcp_key.json")

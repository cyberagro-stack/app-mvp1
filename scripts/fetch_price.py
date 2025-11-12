import gspread
import json
import os
import time

# --- CONFIGURAÇÃO CORRIGIDA ---
NOME_DA_TABELA = "CyberAgro_Precos"
NOME_DA_ABA = "Sheet1" # (Nome padrão após a importação)
PRODUTO_ALVO = "Tommy - produtor" # <-- CORREÇÃO (Linha 3 da sua tabela)
PESO_MEDIO_FALLBACK = 500
JSON_PATH = "mango_prices.json"
# --------------------

try:
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
    # Procura pela última (mais recente) entrada do produto
    for registo in reversed(lista_de_registos): 
        # Procura o nome exato do produto (Coluna 'Produto')
        if registo.get('Produto') and registo['Produto'].strip() == PRODUTO_ALVO:
            dados_manga = registo
            break # Encontra o mais recente e para
            
    if not dados_manga:
        raise ValueError(f"Produto '{PRODUTO_ALVO}' não encontrado na tabela.")

    # Pega o valor da Coluna 'Preço' (Coluna H)
    if 'Preço' not in dados_manga:
        raise ValueError("Coluna 'Preço' em falta na tabela.")

    preco_limpo = float(str(dados_manga.get('Preço', 0)).replace(",", "."))
    peso_limpo = int(dados_manga.get('Peso_Medio_G', PESO_MEDIO_FALLBACK))
    data_str = f"{dados_manga.get('Dia')}/{dados_manga.get('Mês')}/{dados_manga.get('Ano')}"

    novos_dados = {
        "preco_kg": preco_limpo,
        "peso_medio_g": peso_limpo,
        "fonte": dados_manga.get('Região', 'Google Sheets') + f" ({data_str})",
        "ultima_atualizacao": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    }

    print(f"Dados encontrados: {PRODUTO_ALVO} - Preço R${novos_dados['preco_kg']}, Peso {novos_dados['peso_medio_g']}g")
    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(novos_dados, f, indent=2, ensure_ascii=False)
    print("Ficheiro mango_prices.json atualizado com sucesso.")

except Exception as e:
    print(f"Erro fatal: {e}")
    if not os.path

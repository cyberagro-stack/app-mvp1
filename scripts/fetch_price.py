import requests
from bs4 import BeautifulSoup
import json
import os
import re

# URL alvo (CEPEA/ESALQ - Manga Palmer)
# NOTA: Este site é complexo; este scraper é um exemplo.
URL = "https://www.cepea.esalq.usp.br/br/indicador/manga.aspx"
JSON_PATH = "mango_prices.json" # Onde vamos salvar

def fetch_cepea_data():
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(URL, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # O seletor CSS do CEPEA é muito específico
        # Procurando a tabela "Manga Palmer - SP"
        # Esta é a parte FRÁGIL (pode quebrar se o site mudar)
        tabela = soup.find('th', string=re.compile(r'Manga Palmer.*SP'))
        if not tabela:
            print("Não foi possível encontrar a tabela 'Manga Palmer SP'.")
            return None
        
        # Pega a linha da tabela (pai do pai)
        linha = tabela.find_parent('tr')
        if not linha:
            return None
            
        # Pega todas as colunas daquela linha
        colunas = linha.find_all('td')
        
        # O preço em R$ está na coluna 1 (índice 0)
        preco_str = colunas[0].text.strip().replace(',', '.')
        preco_kg = float(re.sub(r'[^\d\.]', '', preco_str))
        
        # O peso médio não está disponível, usaremos um padrão
        peso_medio_g = 510 
        
        # Data da atualização (na coluna 3)
        data_str = colunas[3].text.strip()
        
        return {
            "preco_kg": preco_kg,
            "peso_medio_g": peso_medio_g,
            "fonte": f"CEPEA/ESALQ ({data_str})",
            "ultima_atualizacao": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        }
        
    except Exception as e:
        print(f"Erro durante o scraping: {e}")
        return None

if __name__ == "__main__":
    print("Iniciando a atualização de preços da manga...")
    novos_dados = fetch_cepea_data()
    
    if novos_dados:
        # Abre o JSON antigo para ver se o preço mudou
        dados_antigos = {}
        if os.path.exists(JSON_PATH):
            with open(JSON_PATH, 'r', encoding='utf-8') as f:
                dados_antigos = json.load(f)
        
        if dados_antigos.get("preco_kg") != novos_dados["preco_kg"]:
            print(f"Novo preço encontrado: R$ {novos_dados['preco_kg']}. Atualizando o JSON.")
            with open(JSON_PATH, 'w', encoding='utf-8') as f:
                json.dump(novos_dados, f, indent=2, ensure_ascii=False)
        else:
            print("Preço inalterado. Nenhum commit será feito.")
    else:
        print("Falha ao buscar novos dados. O JSON não será atualizado.")

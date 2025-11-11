import requests
from bs4 import BeautifulSoup
import json
import os
import re
import time

# O URL que você encontrou.
URL = "https://observatoriosdemercado.github.io/manga/2025/semana45/"
JSON_PATH = "mango_prices.json" # Onde vamos salvar

def fetch_data():
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
        }
        response = requests.get(URL, headers=headers)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        
        # Encontra a tabela correta
        table = soup.find('table')
        if not table:
            print("Nenhuma tabela encontrada.")
            return None

        # Procura pela linha (tr) que contém "Tommy"
        rows = table.find_all('tr')
        dados_manga = None
        for row in rows:
            cells = row.find_all('td')
            if cells and "Tommy" in cells[0].text:
                # Encontrámos! Extrair os dados.
                preco_str = cells[1].text
                peso_str = cells[2].text
                
                # Limpa os dados
                preco_kg = float(re.sub(r'[^\d\.]', '', preco_str.replace(",", ".")))
                peso_g = int(re.sub(r'[^\d]', '', peso_str))
                
                dados_manga = {
                    "preco_kg": preco_kg,
                    "peso_medio_g": peso_g,
                    "fonte": "Observatorio de Mercado (GitHub)",
                    "ultima_atualizacao": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                }
                break
        
        return dados_manga
        
    except Exception as e:
        print(f"Erro durante o scraping: {e}")
        return None

if __name__ == "__main__":
    print("Iniciando a atualização de preços da manga...")
    novos_dados = fetch_data()
    
    if novos_dados:
        print(f"Dados encontrados: Preço R${novos_dados['preco_kg']}, Peso {novos_dados['peso_medio_g']}g")
        with open(JSON_PATH, 'w', encoding='utf-8') as f:
            json.dump(novos_dados, f, indent=2, ensure_ascii=False)
        print("Ficheiro mango_prices.json atualizado.")
    else:
        print("Falha ao buscar novos dados. O JSON não será atualizado.")

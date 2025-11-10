// Define um nome para o cache
const CACHE_NAME = 'cyberagro-cache-v1';
// Lista os arquivos que o app precisa para funcionar
const urlsToCache = [
  '/',
  '/index.html',
  '/logo.png'
  // Adicione aqui outros arquivos se precisar (ex: /style.css)
];

// Evento de Instalação: Salva os arquivos no cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Cache aberto');
        return cache.addAll(urlsToCache);
      })
  );
});

// Evento de Fetch: Intercepta os pedidos
self.addEventListener('fetch', event => {
  event.respondWith(
    // 1. Tenta pegar o arquivo do cache
    caches.match(event.request)
      .then(response => {
        // Se achou no cache, retorna ele
        if (response) {
          return response;
        }
        // Se não achou, vai até a internet buscar
        return fetch(event.request);
      }
    )
  );
});
// Opcional: sobrescreva a API base quando hospedar o frontend separado.
// Deixe vazio para o painel testar automaticamente o dominio atual e a Discloud.
window.TG_FORWARD_API_BASE = window.TG_FORWARD_API_BASE || "";

window.TG_FORWARD_API_CANDIDATES = window.TG_FORWARD_API_CANDIDATES || [
  "https://tg-forward-bot.discloud.app/api",
  "https://universo-hot.discloud.app/api"
];

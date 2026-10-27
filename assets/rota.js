// SINDICS — encaminha para o aplicativo (/app/) quem chegou na página de vendas por engano:
// links de e-mail (convite, confirmação, troca de senha, login com Google) e o app instalado pelo endereço antigo.
(function(){
  var h = location.hash || "", q = location.search || "";
  var deAuth = /access_token=|refresh_token=|type=(invite|recovery|signup|magiclink)|error_description=/.test(h) || /[?&](code|error_description)=/.test(q);
  var instalado = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  if (deAuth || instalado) location.replace("app/" + q + h);
})();

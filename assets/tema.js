// SINDICS — aplica o tema escolhido antes da página aparecer (evita piscar).
/* Tema salvo (escuro padrão, claro opcional) aplicado antes de desenhar a tela */
try{ if (localStorage.getItem("sindics-tema") === "light"){ document.documentElement.dataset.theme = "light"; document.querySelector('meta[name="theme-color"]').content = "#e9eff5"; } }catch(_){}

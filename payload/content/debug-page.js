function initialize() {
  const parameters=new URLSearchParams(location.search);
  const title=parameters.get("title")||"Debug sample";
  document.title=title;
  document.getElementById("title").textContent=title;
  document.getElementById("description").textContent=parameters.get("text")||"Sample content for checking the browser interface.";
}
if(document.readyState==="loading")window.addEventListener("DOMContentLoaded",initialize,{once:true});
else initialize();

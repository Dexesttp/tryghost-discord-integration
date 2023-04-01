const functionsText = `
function displayDiscordIntegrationWidget() {
  if (document.getElementById("discord-integration-widget")) {
    console.log("Element already exists");
    return;
  }

  const portal = document.querySelector(".gh-portal-list");
  if (!portal) {
    console.log("Could not find portal element");
    return;
  }

  const section = document.createElement("section");
  section.setAttribute("id", "discord-integration-widget");

  const detailDiv = document.createElement("div");
  detailDiv.setAttribute("class", "gh-portal-list-detail");

  const discordContentDiv = document.createElement("div");
  discordContentDiv.setAttribute(
    "style",
    "display: flex; flex-direction: row; width: 100%;"
  );

  const svgDiv = document.createElement("div");
  svgDiv.setAttribute("style", "flex: 0 0 auto; width: 50px; height: 50px;");
  svgDiv.innerHTML =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M18.942 5.548a16.275 16.275 0 0 0-4.126-1.298c-.178.322-.386.754-.529 1.099a15.132 15.132 0 0 0-4.573 0A11.748 11.748 0 0 0 9.18 4.25a16.222 16.222 0 0 0-4.13 1.301c-2.611 3.95-3.319 7.803-2.965 11.601a16.488 16.488 0 0 0 5.06 2.596c.408-.561.771-1.158 1.084-1.787a10.655 10.655 0 0 1-1.706-.831c.143-.107.283-.217.418-.332 3.29 1.541 6.866 1.541 10.118 0 .137.115.277.226.418.332-.54.326-1.113.606-1.71.833.314.627.675 1.226 1.084 1.787a16.456 16.456 0 0 0 5.064-2.598c.415-4.402-.71-8.22-2.973-11.604zM8.678 14.817c-.988 0-1.798-.924-1.798-2.048s.792-2.05 1.798-2.05c1.005 0 1.815.924 1.798 2.05.001 1.124-.793 2.048-1.798 2.048zm6.644 0c-.988 0-1.798-.924-1.798-2.048s.793-2.05 1.798-2.05c1.006 0 1.816.924 1.798 2.05 0 1.124-.793 2.048-1.798 2.048z"></path></svg>';
  discordContentDiv.appendChild(svgDiv);

  const discordPanelDiv = document.createElement("div");
  discordPanelDiv.setAttribute("style", "flex: 1 1 auto; display: flex; flex-direction: column;");
  const discordPanelTextDiv = document.createElement("h3");
  discordPanelTextDiv.innerText = "Discord Integration";
  discordPanelDiv.appendChild(discordPanelTextDiv);

  const integrationNameDiv = document.createElement("div");
  integrationNameDiv.setAttribute("id", "discord-integration-widget-status");
  integrationNameDiv.innerText = "Not Connected";
  discordPanelDiv.appendChild(integrationNameDiv);

  discordContentDiv.appendChild(discordPanelDiv);

  const discordConnectDisconnectDiv = document.createElement("div");
  discordConnectDisconnectDiv.setAttribute("style", "flex: 0 0 auto;");
  const discordConnectButton = document.createElement("button");
  discordConnectButton.setAttribute("id", "discord-integration-connect-button");
  discordConnectButton.setAttribute("class", "gh-portal-btn");
  discordConnectButton.textContent = "Connect";
  discordConnectButton.addEventListener("click", window.discordIntegrationConnect);
  const discordDisconnectButton = document.createElement("button");
  discordDisconnectButton.setAttribute("id", "discord-integration-disconnect-button");
  discordDisconnectButton.setAttribute("class", "gh-portal-btn");
  discordDisconnectButton.textContent = "Disconnect";
  discordDisconnectButton.addEventListener("click", window.discordIntegrationDisconnect);
  discordConnectDisconnectDiv.appendChild(discordConnectButton);
  discordConnectDisconnectDiv.appendChild(discordDisconnectButton);
  discordContentDiv.appendChild(discordConnectDisconnectDiv);

  detailDiv.appendChild(discordContentDiv);

  section.appendChild(detailDiv);
  portal.appendChild(section);
  rerenderDiscordIntegrationConnectionStatus(window.discordIntegrationStatus);
}

function rerenderDiscordIntegrationConnectionStatus(newStatus) {
  const existing = document.getElementById("discord-integration-widget-status");
  const connectButton = document.getElementById(
    "discord-integration-connect-button"
  );
  const disconnectButton = document.getElementById(
    "discord-integration-disconnect-button"
  );
  if (!existing) {
    if (connectButton) connectButton.style.display = "none";
    if (disconnectButton) disconnectButton.style.display = "none";
    return;
  }

  if (!newStatus) {
    existing.innerText = "Could not get data";
    if (connectButton) connectButton.style.display = "none";
    if (disconnectButton) disconnectButton.style.display = "none";
    return;
  }

  if (newStatus.status !== "Integrated") {
    existing.innerText = "Not Connected";
    if (connectButton) connectButton.style.display = "block";
    if (disconnectButton) disconnectButton.style.display = "none";
    return;
  }

  existing.innerText =
    "Connected as: " +
    newStatus.data.username +
    "#" +
    newStatus.data.discriminator;
  if (connectButton) connectButton.style.display = "none";
  if (disconnectButton) disconnectButton.style.display = "block";
}

function setupMutationObserver() {
  const observer = new MutationObserver(() => {
    if (!document.querySelector(".gh-portal-list")) return;
    displayDiscordIntegrationWidget();
    observer.disconnect();
  });
  observer.observe(document, { childList: true, subtree: true });
}

setupMutationObserver();
displayDiscordIntegrationWidget();

setTimeout(() => {
  window.requestAnimationFrame(() => {
  });
}, 500);
`;

let discordIntegrationStatus = undefined;
function refreshDiscordIntegrationConnectionStatus(callback) {
  fetch("/discord/status")
    .then((r) => r.json())
    .then((response) => {
      discordIntegrationStatus = response;
      if (callback) callback();
    })
    .catch(() => {});
}

function handleDiscordConnection() {
  const popup = window.open(
    "/discord/connect",
    "DiscordAuthorizationWindow",
    "popup,left=100,top=100,width=450,height=650"
  );

  const interval = setInterval(() => {
    refreshDiscordIntegrationConnectionStatus(() => {
      refreshOpenedFrameContent();
      if (
        discordIntegrationStatus &&
        discordIntegrationStatus.status === "Integrated"
      ) {
        if (popup) popup.close();
        clearInterval(interval);
      }
    });
    if (popup && popup.closed) {
      clearInterval(interval);
    }
  }, 2000);
}
function handleDiscordDisconnection() {
  fetch("/discord/disconnect", { method: "POST" }).then(() => {
    refreshDiscordIntegrationConnectionStatus(() => {
      refreshOpenedFrameContent();
    });
  });
}

function refreshFrames() {
  const portalRoot = document.getElementById("ghost-portal-root");
  if (!portalRoot) return;
  const frames = portalRoot.querySelectorAll("iframe");
  for (let frameIndex = 0; frameIndex < frames.length; ++frameIndex) {
    const frame = frames[frameIndex];
    frame.contentWindow.discordIntegrationConnect = () => {
      handleDiscordConnection();
    };
    frame.contentWindow.discordIntegrationDisconnect = () => {
      handleDiscordDisconnection();
    };
    frame.contentWindow.discordIntegrationStatus = discordIntegrationStatus;
    frame.contentWindow.eval(functionsText);
  }
}

function refreshOpenedFrameContent() {
  const portalRoot = document.getElementById("ghost-portal-root");
  if (!portalRoot) return;
  const frames = portalRoot.querySelectorAll("iframe");
  for (let frameIndex = 0; frameIndex < frames.length; ++frameIndex) {
    const frame = frames[frameIndex];
    frame.contentWindow.discordIntegrationStatus = discordIntegrationStatus;
    frame.contentWindow.eval(
      "rerenderDiscordIntegrationConnectionStatus(window.discordIntegrationStatus);"
    );
  }
}

function setupMutationObserver() {
  const portalRoot = document.getElementById("ghost-portal-root");
  if (!portalRoot) return;
  const observer = new MutationObserver(() => {
    refreshDiscordIntegrationConnectionStatus(() => {
      refreshFrames();
    });
  });
  observer.observe(portalRoot, { childList: true });
}

document.addEventListener("DOMContentLoaded", function () {
  setupMutationObserver();
  refreshDiscordIntegrationConnectionStatus();
});

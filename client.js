const socket = io();

const usersUl = document.getElementById("users");
const feed = document.getElementById("feed");
const msg = document.getElementById("msg");
const send = document.getElementById("send");
const btnAudio = document.getElementById("audio");
const btnVideo = document.getElementById("video");
const fileInput = document.getElementById("file");
const fileBtn = document.getElementById("sendFile");
const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const logoutBtn = document.getElementById("logout");

let targetId = null;
let pc;
let localStream;

const rtcConfig = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

// Chat message
send.onclick = () => {
  const text = msg.value.trim();
  if (!text) return;
  socket.emit("chat:msg", text);
  msg.value = "";
};

socket.on("chat:msg", ({ from, text }) => {
  const row = document.createElement("div");
  row.className = "bg-black/20 rounded-xl px-3 py-2";
  row.textContent = `${from}: ${text}`;
  feed.appendChild(row);
  feed.scrollTop = feed.scrollHeight;
});

// File sharing
fileBtn.onclick = async () => {
  if (!fileInput.files.length) return;
  const file = fileInput.files[0];
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch("/upload", { method: "POST", body: formData });
  const data = await res.json();
  socket.emit("share:file", { from: "Me", fileUrl: data.fileUrl, fileName: file.name });
  fileInput.value = "";
};

socket.on("share:file", ({ from, fileUrl, fileName }) => {
  const row = document.createElement("div");
  row.className = "bg-black/20 rounded-xl px-3 py-2";

  if (/\.(jpg|jpeg|png|gif|webp)$/i.test(fileName)) {
    row.innerHTML = `<b>${from}:</b> <a href="${fileUrl}" target="_blank">${fileName}</a><br><img src="${fileUrl}" class="mt-1 max-h-40 rounded-lg"/>`;
  } else if (/\.(mp4|webm|ogg)$/i.test(fileName)) {
    row.innerHTML = `<b>${from}:</b> <a href="${fileUrl}" target="_blank">${fileName}</a><br><video src="${fileUrl}" controls class="mt-1 max-h-40 rounded-lg"></video>`;
  } else {
    row.innerHTML = `<b>${from} shared:</b> <a href="${fileUrl}" target="_blank">${fileName}</a>`;
  }

  feed.appendChild(row);
  feed.scrollTop = feed.scrollHeight;
});

// Online users
socket.on("online:list", (arr) => {
  usersUl.innerHTML = "";
  arr.forEach(({ id, name }) => {
    const li = document.createElement("li");
    li.innerHTML = `<button class="w-full text-left px-3 py-2 rounded-lg hover:bg-white/10">${name} <span class="text-xs text-slate-400">(${id.slice(0,5)})</span></button>`;
    li.querySelector("button").onclick = () => {
      targetId = id;
      [...usersUl.querySelectorAll("button")].forEach(b => b.classList.remove("bg-white/10"));
      li.querySelector("button").classList.add("bg-white/10");
    };
    usersUl.appendChild(li);
  });
});

// Logout
logoutBtn.onclick = async () => {
  await fetch("/logout", { method: "POST" });
  location.href = "/";
};

// WebRTC
async function startCall(withVideo) {
  if (!targetId) return alert("Select a user first.");
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = e => e.candidate && socket.emit("webrtc:ice", { to: targetId, candidate: e.candidate });
  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: withVideo });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  localVideo.srcObject = localStream;

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  socket.emit("webrtc:offer", { to: targetId, offer });
}

btnAudio.onclick = () => startCall(false);
btnVideo.onclick = () => startCall(true);

socket.on("webrtc:offer", async ({ from, name, offer }) => {
  targetId = from;
  pc = new RTCPeerConnection(rtcConfig);
  pc.onicecandidate = e => e.candidate && socket.emit("webrtc:ice", { to: from, candidate: e.candidate });
  pc.ontrack = e => remoteVideo.srcObject = e.streams[0];

  localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
  localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
  localVideo.srcObject = localStream;

  await pc.setRemoteDescription(offer);
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  socket.emit("webrtc:answer", { to: from, answer });

  const row = document.createElement("div");
  row.className = "text-sm text-slate-300";
  row.textContent = `Incoming call from ${name}`;
  feed.appendChild(row);
});

socket.on("webrtc:answer", async ({ answer }) => {
  await pc.setRemoteDescription(answer);
});

socket.on("webrtc:ice", async ({ candidate }) => {
  try { await pc.addIceCandidate(candidate); } catch(e) { console.error(e); }
});

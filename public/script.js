const socket = io();
let localStream;
let peers = {};
let audioPermissionGranted = false;
let remoteAudios = []; 
let username = null; 
let currentGroup = null; // Kullanıcının katıldığı grup

// Bu diziler, "Sesi Başlat" butonuna basana kadar gelen kullanıcıları saklamak için
let pendingUsers = [];
let pendingNewUsers = [];

// Ekran elementleri
const usernameScreen = document.getElementById('usernameScreen');
const groupScreen = document.getElementById('groupScreen');
const callScreen = document.getElementById('callScreen');
const usernameInput = document.getElementById('usernameInput');
const continueButton = document.getElementById('continueButton');
const startCallButton = document.getElementById('startCall');
const displayUsername = document.getElementById('displayUsername');
const groupList = document.getElementById('groupList');
const newGroupName = document.getElementById('newGroupName');
const createGroupButton = document.getElementById('createGroupButton');
const deleteGroupName = document.getElementById('deleteGroupName');
const deleteGroupButton = document.getElementById('deleteGroupButton');
const goToCallButton = document.getElementById('goToCallButton');

// Ekran geçiş fonksiyonu
function showScreen(screenId) {
  usernameScreen.classList.remove('active');
  groupScreen.classList.remove('active');
  callScreen.classList.remove('active');

  if (screenId === 'usernameScreen') usernameScreen.classList.add('active');
  if (screenId === 'groupScreen') groupScreen.classList.add('active');
  if (screenId === 'callScreen') callScreen.classList.add('active');
}

// Başlangıçta username ekranı
showScreen('usernameScreen');

// Kullanıcı "Devam Et" butonuna basınca kullanıcı adı al
continueButton.addEventListener('click', () => {
  const val = usernameInput.value.trim();
  if(val) {
    username = val;
    displayUsername.textContent = username;
    showScreen('groupScreen');
  } else {
    alert("Lütfen bir kullanıcı adı girin.");
  }
});

// Grup oluştur butonu
createGroupButton.addEventListener('click', () => {
  const gName = newGroupName.value.trim();
  if (gName) {
    socket.emit("create-group", gName);
    newGroupName.value = '';
  }
});

// Grup sil butonu
deleteGroupButton.addEventListener('click', () => {
  const gName = deleteGroupName.value.trim();
  if (gName) {
    socket.emit("delete-group", gName);
    deleteGroupName.value = '';
  }
});

// Sesli iletişim ekranına geç
goToCallButton.addEventListener('click', () => {
  if (!currentGroup) {
    alert("Önce bir gruba katılmalısınız.");
    return;
  }
  showScreen('callScreen');
});

// "Sesi Başlat" butonuna basıldığında mikrofon izni iste
startCallButton.addEventListener('click', () => {
  console.log("Sesi Başlat butonuna basıldı. Mikrofon izni isteniyor...");
  navigator.mediaDevices.getUserMedia({ audio: true })
    .then((stream) => { 
      console.log("Mikrofon erişimi verildi:", stream); 
      localStream = stream;
      audioPermissionGranted = true;

      // Önceden gelen remote streamleri çal
      remoteAudios.forEach(audioEl => {
        audioEl.play().catch(err => console.error("Ses oynatılamadı:", err));
      });

      console.log("Ses oynatma izni verildi ve localStream elde edildi.");

      // Şimdi bekleyen kullanıcılar için peer oluştur
      pendingUsers.forEach(userId => {
        initPeer(userId, true);
      });
      pendingUsers = [];

      pendingNewUsers.forEach(userId => {
        initPeer(userId, false);
      });
      pendingNewUsers = [];

    })
    .catch((err) => console.error("Mikrofon erişimi reddedildi:", err));
});

// Sunucudan mevcut kullanıcılar
socket.on("users", (users) => {
  console.log("Mevcut kullanıcılar:", users);
  if (audioPermissionGranted && localStream) {
    users.forEach((userId) => {
      initPeer(userId, true); 
    });
  } else {
    pendingUsers = users;
  }
});

// Yeni kullanıcı
socket.on("new-user", (userId) => {
  console.log("Yeni kullanıcı bağlandı:", userId);
  if (audioPermissionGranted && localStream) {
    initPeer(userId, false);
  } else {
    pendingNewUsers.push(userId);
  }
});

// Gruplar güncellendiğinde listeyi yenile
socket.on("groups", (groups) => {
  groupList.innerHTML = '';
  groups.forEach(g => {
    const li = document.createElement('li');
    li.textContent = g.name;

    // Gruba tıklayınca kullanıcı o gruba "katılmış" olur
    li.addEventListener('click', () => {
      currentGroup = g.name;
      goToCallButton.disabled = false;
      alert(`"${g.name}" grubuna katıldınız. Şimdi "Sesli İletişime Geç" butonuna basabilirsiniz.`);
    });

    groupList.appendChild(li);
  });
});

// Sinyal alımı
socket.on("signal", async (data) => {
  console.log("Signal alındı:", data);
  const { from, signal } = data;

  let peer;
  if (!peers[from]) {
    peer = initPeer(from, false);
  } else {
    peer = peers[from];
  }

  if (signal.type === "offer") {
    await peer.setRemoteDescription(new RTCSessionDescription(signal));
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    console.log("Bağlantıya cevap verildi (answer):", answer);
    socket.emit("signal", { to: from, signal: peer.localDescription });
  } else if (signal.type === "answer") {
    await peer.setRemoteDescription(new RTCSessionDescription(signal));
  } else if (signal.candidate) {
    await peer.addIceCandidate(new RTCIceCandidate(signal));
    console.log("ICE Candidate eklendi:", signal);
  }
});

function initPeer(userId, isInitiator) {
  console.log(`initPeer çağrıldı: userId=${userId}, isInitiator=${isInitiator}`);
  const peer = new RTCPeerConnection({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
    ],
  });
  peers[userId] = peer;

  if (localStream) {
    localStream.getTracks().forEach((track) => peer.addTrack(track, localStream));
  } else {
    console.warn("localStream yokken initPeer çağrıldı!");
  }

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      console.log("Yeni ICE Candidate oluşturuldu:", event.candidate);
      socket.emit("signal", { to: userId, signal: event.candidate });
    } else {
      console.log("ICE Candidate süreci tamamlandı.");
    }
  };

  peer.oniceconnectionstatechange = () => {
    console.log("ICE bağlantı durumu:", peer.iceConnectionState);
  };

  peer.onconnectionstatechange = () => {
    console.log("PeerConnection durumu:", peer.connectionState);
  };

  peer.ontrack = (event) => {
    console.log("Remote stream alındı, izin varsa oynatılacak...");
    const audio = new Audio();
    audio.srcObject = event.streams[0];
    audio.autoplay = false; 
    audio.muted = false;
    remoteAudios.push(audio);

    if (audioPermissionGranted) {
      audio.play().catch(err => console.error("Ses oynatılamadı:", err));
    }
  };

  if (isInitiator) {
    createOffer(peer, userId);
  }

  return peer;
}

async function createOffer(peer, userId) {
  const offer = await peer.createOffer();
  await peer.setLocalDescription(offer);
  console.log("Offer oluşturuldu ve gönderildi:", offer);
  socket.emit("signal", { to: userId, signal: peer.localDescription });
}

socket.on("connect", () => {
  console.log("WebSocket bağlantısı kuruldu. Kullanıcı ID:", socket.id);
});

socket.on("disconnect", () => {
  console.log("WebSocket bağlantısı kesildi.");
});

setInterval(() => {
  console.log("Mevcut PeerConnection'lar:", peers);
}, 10000);

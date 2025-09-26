const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const fs = require("fs").promises; // Usaremos a versão de Promises para fs
const path = require("path");
const { v4: uuidv4 } = require("uuid"); // Para gerar IDs únicos para mensagens

const app = express();
const server = http.createServer(app);

// Caminhos dos arquivos de dados
const USERS_FILE = path.join(__dirname, "users.json");
const CHATS_FILE = path.join(__dirname, "chats.json");

// Middleware para permitir JSON no corpo das requisições (se necessário para futuras rotas)
app.use(express.json());

const io = socketIo(server, {
  cors: {
    origin: "https://my-lua-games.vercel.app", // Seu frontend
    methods: ["GET", "POST"],
  },
});

const PORT = process.env.PORT || 3002;

// --- Estruturas de Dados em Memória (para agilizar o acesso) ---
// { 'userId': 'socketId' }
let onlineUsers = {};
// { 'socketId': 'userId' } - mapeamento inverso
let socketToUser = {};
// Estrutura para o histórico de chat:
// { 'chatId': [{ senderId, receiverId, message, timestamp }] }
// chatId pode ser uma combinação ordenada dos IDs dos usuários, ex: 'user1_user2'
let chatHistories = {};
// Lista de todos os usuários registrados
let allRegisteredUsers = [];

// --- Funções Auxiliares para Leitura/Escrita de Arquivos ---
async function readJsonFile(filePath, defaultData = []) {
  try {
    const data = await fs.readFile(filePath, "utf8");
    return JSON.parse(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      // Arquivo não existe, cria um com os dados padrão
      await fs.writeFile(
        filePath,
        JSON.stringify(defaultData, null, 2),
        "utf8"
      );
      return defaultData;
    }
    console.error(`Erro ao ler ${filePath}:`, error);
    return defaultData; // Retorna dados padrão em caso de erro
  }
}

async function writeJsonFile(filePath, data) {
  try {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), "utf8");
  } catch (error) {
    console.error(`Erro ao escrever ${filePath}:`, error);
  }
}

// Inicializa os dados ao iniciar o servidor
async function initializeData() {
  allRegisteredUsers = await readJsonFile(USERS_FILE, [
    // Usuários de exemplo
    { id: "user1", username: "Alice", status: "offline" },
    { id: "user2", username: "Bob", status: "offline" },
    { id: "user3", username: "Charlie", status: "offline" },
  ]);
  chatHistories = await readJsonFile(CHATS_FILE, {});
  console.log("Dados inicializados.");
  console.log("Usuários registrados:", allRegisteredUsers);
  console.log("Históricos de chat:", chatHistories);
}

// --- Funções de Lógica de Chat ---

// Gera um ID de chat consistente entre dois usuários
function getChatId(userId1, userId2) {
  // Garante que o ID seja o mesmo, independentemente da ordem
  return [userId1, userId2].sort().join("_");
}

async function saveChatMessage(senderId, receiverId, messageContent) {
  const chatId = getChatId(senderId, receiverId);
  if (!chatHistories[chatId]) {
    chatHistories[chatId] = [];
  }

  const message = {
    id: uuidv4(),
    senderId: senderId,
    receiverId: receiverId,
    content: messageContent,
    timestamp: new Date().toISOString(),
  };

  chatHistories[chatId].push(message);
  await writeJsonFile(CHATS_FILE, chatHistories);
  return message; // Retorna a mensagem completa salva
}

// --- Rotas HTTP REST (para buscar usuários, por exemplo) ---
app.get("/api/users", async (req, res) => {
  // Adiciona um pequeno atraso para simular uma chamada de rede, se quiser
  await new Promise((resolve) => setTimeout(resolve, 500));
  res.json(
    allRegisteredUsers.map((u) => ({
      id: u.id,
      username: u.username,
      status: u.status,
    }))
  );
});

// --- Lógica Socket.IO ---
io.on("connection", (socket) => {
  console.log(`Novo cliente conectado: ${socket.id}`);

  // Evento quando o usuário se identifica e "fica online"
  socket.on("userGoesOnline", (userId) => {
    if (!userId) {
      console.warn(
        `Tentativa de userGoesOnline sem userId do socket ${socket.id}`
      );
      return;
    }

    // Remove qualquer registro antigo para este userId (se ele se reconectou)
    if (onlineUsers[userId] && onlineUsers[userId] !== socket.id) {
      const oldSocketId = onlineUsers[userId];
      delete socketToUser[oldSocketId]; // Limpa o mapeamento antigo
      // Opcional: emitir para o socket antigo que ele foi desconectado/substituído
    }

    onlineUsers[userId] = socket.id;
    socketToUser[socket.id] = userId;

    // Atualiza o status do usuário na lista de todos os usuários
    const userIndex = allRegisteredUsers.findIndex((u) => u.id === userId);
    if (userIndex !== -1) {
      allRegisteredUsers[userIndex].status = "online";
    }

    console.log(`Usuário ${userId} (Socket: ${socket.id}) está online.`);
    // Notifica todos os outros usuários sobre a atualização de status
    socket.broadcast.emit("userStatusUpdate", {
      userId: userId,
      status: "online",
    });
    // Opcional: emitir a lista completa de usuários online para o cliente que acabou de conectar
    io.emit("allUsersInSocket", Object.keys(onlineUsers));
    io.emit("allSockets", onlineUsers); // Para o seu frontend que usa allSockets
  });

  // Evento para solicitar histórico de chat entre dois usuários
  socket.on("requestChatHistory", async ({ targetUserId }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId) {
      socket.emit("chatError", "Você não está identificado.");
      return;
    }

    const chatId = getChatId(senderId, targetUserId);
    const history = chatHistories[chatId] || [];

    socket.emit("chatHistory", { friendId: targetUserId, history: history });
    console.log(
      `Histórico de chat entre ${senderId} e ${targetUserId} enviado para ${senderId}.`
    );
  });

  // Evento para enviar mensagens privadas
  socket.on("privateMessage", async ({ targetUserId, message }) => {
    const senderId = socketToUser[socket.id];
    if (!senderId) {
      socket.emit(
        "chatError",
        "Você não está identificado para enviar mensagens."
      );
      return;
    }

    if (!targetUserId) {
      socket.emit("chatError", "O ID do destinatário não foi fornecido.");
      return;
    }

    console.log(
      `Mensagem privada de ${senderId} para ${targetUserId}: ${message}`
    );

    // Salva a mensagem no histórico
    const savedMessage = await saveChatMessage(senderId, targetUserId, message);

    // Envia a mensagem para o destinatário (se estiver online)
    const targetSocketId = onlineUsers[targetUserId];
    if (targetSocketId) {
      io.to(targetSocketId).emit("privateMessageReceived", {
        friendId: senderId, // O remetente é o "amigo" do ponto de vista do destinatário
        message: savedMessage,
      });
      console.log(
        `Mensagem privada enviada para ${targetUserId} (Socket: ${targetSocketId}).`
      );
    } else {
      console.log(`Usuário ${targetUserId} está offline. Mensagem salva.`);
      // Opcional: Você pode emitir um feedback ao remetente que o usuário está offline
      socket.emit(
        "chatError",
        `Usuário ${targetUserId} está offline. Mensagem será entregue quando ele se conectar.`
      );
    }

    // Também envia a mensagem de volta para o próprio remetente para atualizar o chat
    socket.emit("privateMessageReceived", {
      friendId: targetUserId, // O destinatário é o "amigo" do ponto de vista do remetente
      message: savedMessage,
    });
  });

  // Evento de desconexão
  socket.on("disconnect", () => {
    const userId = socketToUser[socket.id];
    if (userId) {
      delete onlineUsers[userId];
      delete socketToUser[socket.id];

      // Atualiza o status do usuário na lista de todos os usuários
      const userIndex = allRegisteredUsers.findIndex((u) => u.id === userId);
      if (userIndex !== -1) {
        allRegisteredUsers[userIndex].status = "offline";
      }

      console.log(`Usuário ${userId} (Socket: ${socket.id}) desconectou.`);
      // Notifica todos os outros usuários sobre a atualização de status
      socket.broadcast.emit("userStatusUpdate", {
        userId: userId,
        status: "offline",
      });
      io.emit("allUsersInSocket", Object.keys(onlineUsers));
      io.emit("allSockets", onlineUsers);
    }
    console.log(`Cliente desconectado: ${socket.id}`);
  });

  // Opcional: Evento userGoesOffline (se quiser um controle explícito do frontend)
  socket.on("userGoesOffline", (userId) => {
    if (onlineUsers[userId] === socket.id) {
      // Só desloga se o socket que enviou for o mesmo logado
      delete onlineUsers[userId];
      delete socketToUser[socket.id];

      const userIndex = allRegisteredUsers.findIndex((u) => u.id === userId);
      if (userIndex !== -1) {
        allRegisteredUsers[userIndex].status = "offline";
      }
      socket.broadcast.emit("userStatusUpdate", {
        userId: userId,
        status: "offline",
      });
      io.emit("allUsersInSocket", Object.keys(onlineUsers));
      io.emit("allSockets", onlineUsers);
      console.log(
        `Usuário ${userId} (Socket: ${socket.id}) explicitamente offline.`
      );
    }
  });
});

// Inicializa os dados e então inicia o servidor
initializeData()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Servidor de chat Socket.IO escutando na porta ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Falha ao inicializar o servidor:", error);
  });

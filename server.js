const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const { supabase, connectDB } = require("./db");
const { addFriend } = require("./functions");

dotenv.config();
connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE"],
  },
});

const onlineUsers = {};
const PORT = process.env.PORT || 3001;

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("join_room", (chatId) => {
    socket.join(chatId);
    console.log(`Socket ${socket.id} joined room ${chatId}`);
  });

  socket.on("leave_room", (chatId) => {
    socket.leave(chatId);
    console.log(`Socket ${socket.id} left room ${chatId}`);
  });

  socket.on("disconnect", async () => {
    console.log(`Client disconnected: ${socket.id}`);
    const disconnectedUserId = socket.userId;
    if (disconnectedUserId && onlineUsers[disconnectedUserId] === socket.id) {
      delete onlineUsers[disconnectedUserId];
      await emitOnlineUsersUpdate();
    }
  });

  //user
  socket.on("create_user", async (user) => {
    if (!user || !user.id || !user.name) {
      return socket.emit("chat_error", "Dados de usuário inválidos.");
    }
    try {
      const newUser = await createUser(user);
      socket.userId = user.id;
      onlineUsers[user.id] = socket.id;
      socket.emit("user_created", newUser);
      socket.join("general");
    } catch (error) {
      console.error("Erro ao criar usuário:", error);
      socket.emit("chat_error", "Erro ao criar usuário. Tente novamente.");
    }
  });

  socket.on("user_connect", async (user) => {
    if (!user || !user.id || !user.name) {
      return socket.emit("chat_error", "Dados de usuário inválidos.");
    }
    try {
      socket.join("general");
      getAllUsers();
    } catch (error) {
      console.error("Erro ao conectar usuário:", error);
      socket.emit("chat_error", "Erro ao conectar. Tente novamente.");
    }
  });

  socket.on("edit_user", async (user) => {
    if (!user || !user.id || !user.name) {
      return socket.emit("chat_error", "Dados de usuário inválidos.");
    }
    try {
      const editedUser = await editUser(user);
      socket.emit("user_edited", editedUser);
    } catch (error) {
      console.error("Erro ao editar usuário:", error);
      socket.emit("chat_error", "Erro ao editar usuário. Tente novamente.");
    }
  });

  socket.on("remove_user", async (userId) => {
    if (!userId) {
      return socket.emit("chat_error", "ID de usuário inválido.");
    }
    try {
      const removedUser = await removeUser(userId);
      if (removedUser) {
        socket.leave("general");
        socket.emit("user_removed", removedUser);
      }
    } catch (error) {
      console.error("Erro ao remover usuário:", error);
      socket.emit("chat_error", "Erro ao remover usuário. Tente novamente.");
    }
  });

  //chat
  sockert.on("create_chat", async ({ chatId, users, isPrivate }) => {
    if (!chatId || !Array.isArray(users) || users.length === 0) {
      return socket.emit("chat_error", "Dados de chat inválidos.");
    }

    try {
      const newChat = createChat({ id: chatId, users, isPrivate });
      socket.emit("chat_created", newChat);
      console.log("Chat criado:", newChat);
    } catch (error) {
      console.error("Erro ao criar chat:", error);
      socket.emit("chat_error", "Erro ao criar chat. Tente novamente.");
    }
  });

  socket.on("remove_chat", async (chatId) => {
    if (!chatId) {
      return socket.emit("chat_error", "ID de chat inválido.");
    }
    try {
      const removedChat = await removeChat(chatId);
      console.log("Chat removido:", removedChat);
    } catch (error) {
      console.error("Erro ao remover chat:", error);
      socket.emit("chat_error", "Erro ao remover chat. Tente novamente.");
    }
  });

  socket.on("get_all_chat_user", async (userId) => {
    if (!userId) {
      return socket.emit("chat_error", "ID de usuário inválido.");
    }
    try {
      const chats = await getUserChats(userId);
      socket.emit("user_chats", chats);
    } catch (error) {
      console.error("Erro ao buscar chats do usuário:", error);
      socket.emit("chat_error", "Erro ao buscar chats. Tente novamente.");
    }
  });

  socket.on("get_all_chat_messages", async (chatId) => {
    if (!chatId) {
      return socket.emit("chat_error", "ID de chat inválido.");
    }
    try {
      const messages = await getChatMessages(chatId);
      socket.emit("chat_messages", { chatId, messages });
    } catch (error) {
      console.error("Erro ao buscar mensagens do chat:", error);
      socket.emit("chat_error", "Erro ao buscar mensagens. Tente novamente.");
    }
  });

  //friend
  socket.on("get_user_friends", async (userId) => {
    if (!userId) {
      return socket.emit("chat_error", "ID de usuário inválido.");
    }
    try {
      const friends = await getUserFriends(userId);
      socket.emit("user_friends", friends);
    } catch (error) {
      console.error("Erro ao buscar amigos do usuário:", error);
      socket.emit("chat_error", "Erro ao buscar amigos. Tente novamente.");
    }
  });

  socket.on("add_friend", async ({ userId, friendId }) => {
    if (!userId || !friendId) {
      return socket.emit("chat_error", "Dados de amizade inválidos.");
    }
    try {
      const newFriend = addFriend({ userId, friendId });
      socket.emit("friend_added", newFriend);
      console.log("Amigo adicionado:", newFriend);
    } catch (error) {
      console.error("Erro ao adicionar amigo:", error);
      socket.emit("chat_error", "Erro ao adicionar amigo. Tente novamente.");
    }
  });

  socket.on("remove_friend", async ({ userId, friendId }) => {
    if (!userId || !friendId) {
      return socket.emit("chat_error", "Dados de amizade inválidos.");
    }
    try {
      const removedFriend = await removeFriend({ userId, friendId });
      console.log("Amigo removido:", removedFriend);
    } catch (error) {
      console.error("Erro ao remover amigo:", error);
      socket.emit("chat_error", "Erro ao remover amigo. Tente novamente.");
    }
  });

  socket.on("send_message", async ({ chatId, userId, message }) => {
    if (!chatId || !userId || !message) {
      return socket.emit("chat_error", "Dados de mensagem inválidos.");
    }

    try {
      const { data: newMessage, error: insertError } = await supabase
        .from("messages")
        .insert([
          {
            userId: userId,
            chatId: chatId,
            message: message,
            timestamp: new Date().toISOString(),
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      const { data: senderUser, error: senderError } = await supabase
        .from("users")
        .select("name")
        .eq("id", userId)
        .single();

      if (senderError) throw senderError;

      const messageToSend = {
        ...newMessage,
        userName: senderUser.name,
      };

      io.to(chatId).emit("new_message", { chatId, message: messageToSend });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      socket.emit("chat_error", "Erro ao enviar mensagem. Tente novamente.");
    }
  });

  server.listen(PORT, async () => {
    try {
      const { data: generalChat, error: generalChatError } = await supabase
        .from("chats")
        .select("*")
        .eq("id", "general")
        .single();

      if (generalChatError && generalChatError.code !== "PGRST116") {
        throw generalChatError;
      }

      if (!generalChat) {
        const { error: insertError } = await supabase.from("chats").insert([
          {
            id: "general",
            users: [],
            isPrivate: false,
          },
        ]);
        if (insertError) throw insertError;
      }
    } catch (error) {
      console.error("Erro ao verificar/criar sala geral:", error);
    }
    console.log(`Servidor Socket.IO rodando na porta ${PORT}`);
  });
});

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const dotenv = require("dotenv");
const { supabase, connectDB } = require("./db");

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

connectDB();

const onlineUsers = {}; // Stores userId: socket.id mapping
const PORT = process.env.PORT || 3001; // Define PORT here

// Helper function to emit updated online users list
async function emitOnlineUsersUpdate() {
  try {
    const { data: allDbUsers, error: usersError } = await supabase
      .from("users")
      .select("*");

    if (usersError) throw usersError;

    // Filter DB users to only include those whose IDs are in our onlineUsers map
    const currentOnlineUsers = allDbUsers.filter(
      (dbUser) => onlineUsers[dbUser.id]
    );

    // Emit the updated list of online users to everyone
    io.emit("online_users", currentOnlineUsers);
  } catch (error) {
    console.error("Error emitting online users update:", error);
  }
}

// --- Socket.IO Connection Handler ---
io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Store userId on the socket object for easier lookup on disconnect
  socket.userId = null;

  socket.on("user_connect", async (user) => {
    if (!user || !user.id || !user.name) {
      return socket.emit("chat_error", "Dados de usuário inválidos.");
    }

    try {
      const { data: existingUsers, error: selectError } = await supabase
        .from("users")
        .select("id")
        .eq("id", user.id);

      if (selectError) throw selectError;

      if (existingUsers.length === 0) {
        const { error: insertError } = await supabase.from("users").insert([
          {
            id: user.id,
            name: user.name,
          },
        ]);
        if (insertError) throw insertError;
      }

      onlineUsers[user.id] = socket.id; // Map userId to socket.id
      socket.userId = user.id; // Store userId directly on the socket

      socket.join("general"); // Join the general chat room

      await emitOnlineUsersUpdate(); // Emit updated list

      // Optional: Emit initial friends data here (fetch from DB for `user.id`)
      // const { data: friendsData, error: friendsError } = await supabase
      //   .from("friends_table") // Replace with your actual table
      //   .select("*")
      //   .eq("user_id", user.id);
      // if (!friendsError) {
      //   socket.emit("initial_friends_data", {
      //     friends: friendsData.friends_list || [],
      //     requestsSent: friendsData.requests_sent || [],
      //     requestsReceived: friendsData.requests_received || [],
      //   });
      // }
    } catch (error) {
      console.error("Erro ao conectar usuário:", error);
      socket.emit("chat_error", "Erro ao conectar. Tente novamente.");
    }
  });

  // Client sends a message
  socket.on("send_message", async ({ chatId, userId, message }) => {
    // Corrected: socket.on
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
        userName: senderUser.name, // Use userName for display
      };

      io.to(chatId).emit("new_message", { chatId, message: messageToSend });
    } catch (error) {
      console.error("Erro ao enviar mensagem:", error);
      socket.emit("chat_error", "Erro ao enviar mensagem. Tente novamente.");
    }
  });

  // Client requests to join a room
  socket.on("join_room", (chatId) => {
    // Corrected: socket.on
    socket.join(chatId);
    console.log(`Socket ${socket.id} joined room ${chatId}`);
  });

  // Client requests to leave a room
  socket.on("leave_room", (chatId) => {
    // Corrected: socket.on
    socket.leave(chatId);
    console.log(`Socket ${socket.id} left room ${chatId}`);
  });

  // Client requests to create a private room (often implicit with 'create_private_chat')
  socket.on("create_private_room", async (users) => {
    // Corrected: socket.on
    try {
      const { data: newChat, error: insertError } = await supabase
        .from("chats")
        .insert([
          {
            users: users,
            isPrivate: true,
          },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // Join the creator's socket to the new private chat room
      socket.join(newChat.id);
      console.log(
        `Private chat ${newChat.id} created and ${socket.id} joined.`
      );

      // Inform other user(s) to join this room if they are online
      for (const userIdInChat of users) {
        if (userIdInChat !== socket.userId && onlineUsers[userIdInChat]) {
          io.sockets.sockets.get(onlineUsers[userIdInChat])?.join(newChat.id);
          // Also, emit private_chat_created to them
          io.to(onlineUsers[userIdInChat]).emit("private_chat_created", {
            chatId: newChat.id,
            users: users, // You might want to fetch full user objects here
            messages: [],
          });
        }
      }

      // Emit private_chat_created to the creator as well
      socket.emit("private_chat_created", {
        chatId: newChat.id,
        users: users,
        messages: [],
      });
    } catch (error) {
      console.error("Erro ao criar sala privada:", error);
      socket.emit("chat_error", "Erro ao criar sala privada. Tente novamente.");
    }
  });

  // Client requests chat history
  socket.on("request_chat_history", async (chatId) => {
    try {
      const { data: messages, error } = await supabase
        .from("messages")
        .select("*")
        .eq("chatId", chatId)
        .order("timestamp", { ascending: true });

      if (error) throw error;

      const messagesWithUserNames = await Promise.all(
        messages.map(async (msg) => {
          const { data: user, error: userError } = await supabase
            .from("users")
            .select("name")
            .eq("id", msg.userId)
            .single();
          if (userError) {
            console.error(
              "Error fetching user for chat history message:",
              userError
            );
            return { ...msg, userName: "Unknown" };
          }
          return { ...msg, userName: user.name };
        })
      );

      socket.emit("chat_history", { chatId, messages: messagesWithUserNames });
    } catch (error) {
      console.error("Error fetching chat history:", error);
      socket.emit("chat_error", "Erro ao carregar histórico do chat.");
    }
  });

  // Client disconnects
  socket.on("disconnect", async () => {
    // Corrected: socket.on
    console.log(`Client disconnected: ${socket.id}`);
    const disconnectedUserId = socket.userId; // Use userId stored on socket

    if (disconnectedUserId && onlineUsers[disconnectedUserId] === socket.id) {
      // Only delete if the socket.id matches, to handle multi-device scenarios if you expand
      delete onlineUsers[disconnectedUserId];
      await emitOnlineUsersUpdate(); // Emit updated list
    }
  });

  // --- FRIENDSHIP RELATED SOCKET EVENTS ---
  socket.on("send_friend_request", async (receiverId) => {
    // Current user (sender) is socket.userId
    const senderId = socket.userId;
    if (!senderId)
      return socket.emit("chat_error", "Remetente não identificado.");

    try {
      // 1. Save request in DB (e.g., a 'friend_requests' table)
      const { data: newRequest, error: insertError } = await supabase
        .from("friend_requests")
        .insert([
          { sender_id: senderId, receiver_id: receiverId, status: "pending" },
        ])
        .select()
        .single();

      if (insertError) throw insertError;

      // 2. Notify receiver if online
      const receiverSocketId = onlineUsers[receiverId];
      if (receiverSocketId) {
        io.to(receiverSocketId).emit("friend_request_received", {
          id: newRequest.id,
          senderId: senderId,
          senderName: (
            await supabase
              .from("users")
              .select("name")
              .eq("id", senderId)
              .single()
          ).data.name,
          // Add other request details
        });
      }

      // 3. Notify sender of success
      socket.emit("friend_request_sent_success", {
        id: newRequest.id,
        receiverId: receiverId,
        receiverName: (
          await supabase
            .from("users")
            .select("name")
            .eq("id", receiverId)
            .single()
        ).data.name,
      });
    } catch (error) {
      console.error("Erro ao enviar pedido de amizade:", error);
      socket.emit(
        "chat_error",
        "Erro ao enviar pedido de amizade. Tente novamente."
      );
    }
  });

  socket.on("accept_friend_request", async (senderId) => {
    const receiverId = socket.userId; // Current user (receiver)
    if (!receiverId)
      return socket.emit("chat_error", "Destinatário não identificado.");

    try {
      // 1. Update request status in DB
      await supabase
        .from("friend_requests")
        .update({ status: "accepted" })
        .eq("sender_id", senderId)
        .eq("receiver_id", receiverId);

      // 2. Add friendship in DB (e.g., a 'friends' table or a join table)
      // This might involve two inserts or updating an array of friends on each user's profile
      await supabase
        .from("friends")
        .insert([{ user1_id: senderId, user2_id: receiverId }]);

      // 3. Get user names for notification
      const { data: senderUser, error: senderUserError } = await supabase
        .from("users")
        .select("id, name")
        .eq("id", senderId)
        .single();
      const { data: receiverUser, error: receiverUserError } = await supabase
        .from("users")
        .select("id, name")
        .eq("id", receiverId)
        .single();
      if (senderUserError || receiverUserError)
        throw new Error("Could not fetch sender/receiver names");

      // 4. Notify both users
      const senderSocketId = onlineUsers[senderId];
      if (senderSocketId) {
        io.to(senderSocketId).emit("friend_request_accepted", receiverUser); // Friend object for sender
      }
      socket.emit("friend_request_accepted", senderUser); // Friend object for receiver
      // You might also want to remove the request from their respective lists (client-side or server-side emit)
    } catch (error) {
      console.error("Erro ao aceitar pedido de amizade:", error);
      socket.emit(
        "chat_error",
        "Erro ao aceitar pedido de amizade. Tente novamente."
      );
    }
  });

  socket.on("reject_friend_request", async (senderId) => {
    const receiverId = socket.userId;
    if (!receiverId)
      return socket.emit("chat_error", "Destinatário não identificado.");

    try {
      // 1. Update request status to 'rejected' or delete it
      await supabase
        .from("friend_requests")
        .update({ status: "rejected" })
        .eq("sender_id", senderId)
        .eq("receiver_id", receiverId);

      // 2. Notify sender
      const senderSocketId = onlineUsers[senderId];
      if (senderSocketId) {
        io.to(senderSocketId).emit("friend_request_rejected", receiverId); // Send ID of user who rejected
      }
      socket.emit("friend_request_rejected", senderId); // Confirm rejection to receiver
    } catch (error) {
      console.error("Erro ao rejeitar pedido de amizade:", error);
      socket.emit(
        "chat_error",
        "Erro ao rejeitar pedido de amizade. Tente novamente."
      );
    }
  });

  socket.on("remove_friend", async (friendId) => {
    const userId = socket.userId;
    if (!userId) return socket.emit("chat_error", "Usuário não identificado.");

    try {
      // 1. Remove friendship from DB
      await supabase
        .from("friends")
        .delete()
        .or(
          `(user1_id.eq.${userId},user2_id.eq.${friendId}),(user1_id.eq.${friendId},user2_id.eq.${userId})`
        );

      // 2. Notify both users
      const friendSocketId = onlineUsers[friendId];
      if (friendSocketId) {
        io.to(friendSocketId).emit("friend_removed", userId);
      }
      socket.emit("friend_removed", friendId);
    } catch (error) {
      console.error("Erro ao remover amigo:", error);
      socket.emit("chat_error", "Erro ao remover amigo. Tente novamente.");
    }
  });

  // --- Removed redundant/misplaced io.on handlers ---
  // io.on("user_disconnect", ...); // Handled by socket.on("disconnect")
  // io.on("online_users", ...);    // Handled by emitOnlineUsersUpdate()
  // io.on("error", ...);           // Less common for client errors, server-side io.on('error') is for global issues
  // io.on("connect_error", ...);   // These are generally for the global server, not individual client sockets
  // io.on("disconnect_error", ...);
  // io.on("reconnect_error", ...);
  // io.on("reconnect", ...);
});

// --- Server Startup Logic (THIS BLOCK IS CRUCIAL AND MUST BE OUTSIDE io.on('connection')) ---
server.listen(PORT, async () => {
  try {
    const { data: generalChat, error: generalChatError } = await supabase
      .from("chats")
      .select("*")
      .eq("id", "general")
      .single();

    if (generalChatError && generalChatError.code !== "PGRST116") {
      // PGRST116 means "no rows found"
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
      console.log("General chat room created.");
    } else {
      console.log("General chat room already exists.");
    }
  } catch (error) {
    console.error("Erro ao verificar/criar sala geral:", error);
  }
  console.log(`Servidor Socket.IO rodando na porta ${PORT}`);
});

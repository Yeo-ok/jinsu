const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const CLIENT_ORIGIN = 'https://shiny-invention-wwpr5qvggphvvr9-3000.app.github.dev';

app.use(cors({
  origin: CLIENT_ORIGIN,
  methods: ["GET", "POST"],
  credentials: true
}));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"],
    credentials: true
  }
});

const rooms = {};

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 8;
const INITIAL_GARNETS = 10;
const NUMBERS_TO_AUCTION = Array.from({ length: 21 }, (_, i) => i - 10);

const emitRoomUpdate = (roomId) => {
  if (rooms[roomId]) {
    io.to(roomId).emit('roomUpdate', {
      players: rooms[roomId].players.map(p => ({ id: p.id, username: p.username })),
      host: rooms[roomId].host,
      gameState: rooms[roomId].gameState
    });
  }
};

const initializeGame = (roomId) => {
  const room = rooms[roomId];
  if (!room || room.players.length < MIN_PLAYERS) return;

  room.gameState = {
    numbers: [...NUMBERS_TO_AUCTION],
    currentPlayerIndex: 0,
    currentAuction: {
      number: null,
      bids: {},
      highestBidder: null,
      highestBid: 0,
      bidCount: 0,
    },
    playerData: room.players.reduce((acc, player) => {
      acc[player.id] = {
        garnets: INITIAL_GARNETS,
        numbers: [],
        username: player.username,
        isReady: false,
      };
      return acc;
    }, {}),
    log: ["게임이 시작되었습니다."],
    isGameOver: false,
    round: 0,
  };

  startNextAuction(roomId);
};

const startNextAuction = (roomId) => {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;

  room.gameState.round++;
  const remainingNumbers = room.gameState.numbers;

  if (remainingNumbers.length === 0) {
    endGame(roomId);
    return;
  }

  const numberToAuction = remainingNumbers.shift();
  room.gameState.currentAuction = {
    number: numberToAuction,
    bids: {},
    highestBidder: null,
    highestBid: 0,
    bidCount: 0,
  };

  room.gameState.log.push(`라운드 ${room.gameState.round}: 숫자 ${numberToAuction}에 대한 경매가 시작되었습니다.`);
  io.to(roomId).emit('gameStateUpdate', room.gameState);
};

const resolveAuction = (roomId) => {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;

  const currentAuction = room.gameState.currentAuction;
  const bids = Object.entries(currentAuction.bids);

  if (bids.length === 0) {
    room.gameState.log.push(`${currentAuction.number}번에 대해 아무도 입찰하지 않았습니다. 숫자는 폐기됩니다.`);
    io.to(roomId).emit('gameStateUpdate', room.gameState);
    startNextAuction(roomId);
    return;
  }

  bids.sort((a, b) => a[1] - b[1]);
  const lowestBid = bids[0][1];
  const lowestBidders = bids.filter(bid => bid[1] === lowestBid);

  if (lowestBidders.length === 1) {
    const winnerId = lowestBidders[0][0];
    const winner = room.gameState.playerData[winnerId];
    winner.garnets -= lowestBid;
    winner.numbers.push(currentAuction.number);
    room.gameState.log.push(`${winner.username}님이 ${lowestBid} 가넷으로 ${currentAuction.number}을(를) 낙찰받았습니다.`);
  } else {
    room.gameState.log.push(`${currentAuction.number}에 대해 가장 낮은 입찰자가 여러 명입니다. 숫자는 폐기됩니다.`);
  }

  io.to(roomId).emit('gameStateUpdate', room.gameState);
  startNextAuction(roomId);
};

const endGame = (roomId) => {
  const room = rooms[roomId];
  if (!room || !room.gameState) return;

  room.gameState.isGameOver = true;
  room.gameState.log.push('모든 숫자에 대한 경매가 완료되었습니다. 게임이 종료됩니다.');

  const scores = Object.entries(room.gameState.playerData).map(([id, data]) => ({
    id,
    username: data.username,
    score: data.numbers.reduce((sum, num) => sum + num, 0),
    garnets: data.garnets,
    numbers: data.numbers,
  }));

  scores.sort((a, b) => a.score - b.score);

  room.gameState.finalScores = scores;
  io.to(roomId).emit('gameStateUpdate', room.gameState);
  io.to(roomId).emit('gameEnd', room.gameState);
};

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('createRoom', ({ username, maxPlayers }) => {
    const roomId = Math.random().toString(36).substring(2, 7).toUpperCase();
    if (rooms[roomId]) {
      socket.emit('error', { message: '방 생성에 실패했습니다. 다시 시도해주세요.' });
      return;
    }
    const parsedMaxPlayers = parseInt(maxPlayers, 10);
    if (isNaN(parsedMaxPlayers) || parsedMaxPlayers < MIN_PLAYERS || parsedMaxPlayers > MAX_PLAYERS) {
      socket.emit('error', { message: `플레이어 수는 ${MIN_PLAYERS}명에서 ${MAX_PLAYERS}명 사이여야 합니다.` });
      return;
    }

    rooms[roomId] = {
      players: [{ id: socket.id, username }],
      maxPlayers: parsedMaxPlayers,
      host: socket.id,
      gameState: null,
    };
    socket.join(roomId);
    socket.emit('roomCreated', {
      roomId,
      players: rooms[roomId].players,
      host: rooms[roomId].host,
      maxPlayers: rooms[roomId].maxPlayers
    });
    emitRoomUpdate(roomId);
  });

  socket.on('joinRoom', ({ roomId, username }) => {
    const room = rooms[roomId];
    if (!room) {
      socket.emit('error', { message: '존재하지 않는 방 코드입니다.' });
      return;
    }
    if (room.players.length >= room.maxPlayers) {
      socket.emit('error', { message: '방이 가득 찼습니다.' });
      return;
    }
    if (room.gameState) {
      socket.emit('error', { message: '이미 게임이 시작된 방입니다.' });
      return;
    }

    room.players.push({ id: socket.id, username });
    socket.join(roomId);
    socket.emit('joinedRoom', {
      roomId,
      players: room.players,
      host: room.host,
      maxPlayers: room.maxPlayers
    });
    emitRoomUpdate(roomId);
  });

  socket.on('startGame', (roomId) => {
    const room = rooms[roomId];
    if (room && room.host === socket.id) {
      if (room.players.length < MIN_PLAYERS) {
        socket.emit('error', { message: `최소 ${MIN_PLAYERS}명 이상의 플레이어가 필요합니다.` });
        return;
      }
      initializeGame(roomId);
      io.to(roomId).emit('gameStarted');
      emitRoomUpdate(roomId);
    } else {
      socket.emit('error', { message: '게임은 방장만 시작할 수 있습니다.' });
    }
  });

  socket.on('placeBid', ({ roomId, bid }) => {
    const room = rooms[roomId];
    if (!room || !room.gameState || room.gameState.isGameOver) return;

    const currentAuction = room.gameState.currentAuction;
    const player = room.gameState.playerData[socket.id];

    if (!player) {
      socket.emit('error', { message: '플레이어 정보를 찾을 수 없습니다.' });
      return;
    }
    if (player.garnets < bid) {
      socket.emit('error', { message: '가넷이 부족합니다.' });
      return;
    }
    if (bid <= 0) {
      socket.emit('error', { message: '입찰 금액은 0보다 커야 합니다.' });
      return;
    }
    if (currentAuction.bids[socket.id]) {
      socket.emit('error', { message: '이미 입찰했습니다.' });
      return;
    }

    currentAuction.bids[socket.id] = bid;
    currentAuction.bidCount++;
    room.gameState.log.push(`${player.username}님이 ${bid} 가넷을 입찰했습니다.`);

    io.to(roomId).emit('gameStateUpdate', room.gameState);

  });

  socket.on('endBid', ({ roomId }) => {
        resolveAuction(roomId);
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
    for (const roomId in rooms) {
      const room = rooms[roomId];
      const playerIndex = room.players.findIndex(p => p.id === socket.id);
      if (playerIndex > -1) {
        room.players.splice(playerIndex, 1);
        io.to(roomId).emit('playerUpdate', room.players.map(p => ({ id: p.id, username: p.username })));
        if (room.players.length === 0) {
          delete rooms[roomId];
        } else {
          if (room.host === socket.id) {
            room.host = room.players[0].id;
            io.to(roomId).emit('hostUpdate', room.host);
          }
          if (room.gameState && !room.gameState.isGameOver) {
            room.gameState.log.push(`${room.gameState.playerData[socket.id]?.username || '알 수 없는 사용자'}님이 연결을 끊었습니다. 게임이 종료되었습니다.`);
            endGame(roomId);
          }
        }
        break;
      }
    }
  });
});

// 정적 파일 서빙
app.use(express.static(path.join(__dirname, '..', 'client', 'build')));

// 와일드카드 라우트
app.get('/*', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'client', 'build', 'index.html'));
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

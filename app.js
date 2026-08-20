/**
 * Chess 2P App — chess.com style pieces, PGN resume, PeerJS online
 * ================================================================
 * Pieces: Chess.com Neo set via their public CDN (w/b + K/Q/R/B/N/P)
 * Online: PeerJS WebRTC peer-to-peer (no backend needed)
 */

// ============================================================
//  PIECE IMAGES — local piece set (chess.com Neo, copied from chessTrick)
// ============================================================
const PIECE_DIR = 'pieces/';
const PIECE_FALLBACK = 'https://lichess1.org/assets/piece/cburnett/';

function pieceImgSrc(color, type, useFallback = false) {
    if (useFallback) {
        const map = {
            wp:'wP', wn:'wN', wb:'wB', wr:'wR', wq:'wQ', wk:'wK',
            bp:'bP', bn:'bN', bb:'bB', br:'bR', bq:'bQ', bk:'bK'
        };
        return PIECE_FALLBACK + map[color + type] + '.svg';
    }
    // local files: color lowercase + type lowercase, e.g. wK.png -> wk.png
    return PIECE_DIR + color + type.toLowerCase() + '.png';
}

// Unicode fallback (in case both CDNs fail)
const UNICODE_PIECES = {
    wp:'♙', wn:'♘', wb:'♗', wr:'♖', wq:'♕', wk:'♔',
    bp:'♟', bn:'♞', bb:'♝', br:'♜', bq:'♛', bk:'♚'
};

// ============================================================
//  PGN PARSER
// ============================================================
const PGN = {
    parse(text) {
        const headers = {};
        let moveText = '';
        let inHead = true;
        for (const line of text.trim().split(/\r?\n/)) {
            const t = line.trim();
            if (t.startsWith('[') && inHead) {
                const m = t.match(/^\[(\w+)\s+"(.*)"\]$/);
                if (m) headers[m[1]] = m[2];
            } else {
                inHead = false;
                moveText += ' ' + t;
            }
        }
        // Strip comments, variations, NAGs, result (depth-aware — handles nesting)
        moveText = this.stripExtras(moveText);
        // Remove move numbers
        moveText = moveText.replace(/\d+\.+/g, '');
        const moves = moveText.trim().split(/\s+/).filter(m => m && m !== '...');
        return { headers, moves };
    },

    /**
     * Remove braces {comments}, parentheses (variations), NAGs ($n) and a
     * trailing result token. Depth-aware so nested '{ ( } )' parse correctly.
     */
    stripExtras(text) {
        let out = '';
        let depth = 0;
        // Keep a second depth for braces so ') }' crossing pairs is handled.
        // PGN only allows same-start-depth nesting, and nesting depth is small.
        let braceDepth = 0;
        let parenDepth = 0;
        for (let i = 0; i < text.length; i++) {
            const ch = text[i];
            if (ch === '{') { braceDepth++; continue; }
            if (ch === '}') { braceDepth = Math.max(0, braceDepth - 1); continue; }
            if (ch === '(') { parenDepth++; continue; }
            if (ch === ')') { parenDepth = Math.max(0, parenDepth - 1); continue; }
            if (braceDepth === 0 && parenDepth === 0) out += ch;
        }
        // NAGs (e.g. $1)
        out = out.replace(/\$\d+/g, '');
        // Trailing result token
        out = out.replace(/\s*(1-0|0-1|1\/2-1\/2|\*)\s*$/g, '');
        return out;
    },

    replay(moves, upTo) {
        const eng = new ChessEngine();
        const fens = [eng.generateFen()];
        const sans = [];
        for (let i = 0; i < Math.min(moves.length, upTo); i++) {
            if (!this.applySAN(eng, moves[i])) {
                throw new Error(`Illegal move at ${i + 1}: "${moves[i]}"`);
            }
            sans.push(moves[i]);
            fens.push(eng.generateFen());
        }
        return { eng, sans, fens };
    },

    applySAN(eng, san) {
        // Castling
        const clean = san.replace(/[+#!?]/g, '');
        if (clean === 'O-O-O' || clean === '0-0-0') {
            const row = eng.turn === 'w' ? 7 : 0;
            return eng.makeMove({ r: row, c: 4 }, { r: row, c: 2 }, 'q');
        }
        if (clean === 'O-O' || clean === '0-0') {
            const row = eng.turn === 'w' ? 7 : 0;
            return eng.makeMove({ r: row, c: 4 }, { r: row, c: 6 }, 'q');
        }

        let promoPiece = 'q';
        const promoM = san.match(/=([QRBN])/i);
        if (promoM) promoPiece = promoM[1].toLowerCase();

        let pieceType = 'p';
        let rest = san;
        if (/^[KQRBN]/.test(san)) { pieceType = san[0].toLowerCase(); rest = san.slice(1); }

        rest = rest.replace(/[+#!=?xQRBN$\d]/g, '').trim();
        // re-extract destination
        const destM = san.replace(/[+#!?]/g, '').match(/([a-h][1-8])(?:=[QRBN])?$/i);
        if (!destM) return false;
        const toCol = destM[1].charCodeAt(0) - 97;
        const toRow = 8 - parseInt(destM[1][1], 10);

        // Disambiguation: characters before destination
        const fullClean = san.replace(/[+#!?]/g, '');
        let prefix = '';
        if (pieceType !== 'p') {
            const after = fullClean.slice(1); // skip piece letter
            prefix = after.replace(/x?[a-h][1-8](=[QRBN])?$/, '');
        } else {
            prefix = fullClean.replace(/x?[a-h][1-8](=[QRBN])?$/, '');
        }

        const candidates = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = eng.board[r][c];
                if (!p || p.type !== pieceType || p.color !== eng.turn) continue;
                const lm = eng.getLegalMoves(r, c);
                if (lm.some(m => m.to.r === toRow && m.to.c === toCol)) {
                    candidates.push({ r, c });
                }
            }
        }
        if (!candidates.length) return false;

        let from = candidates[0];
        if (candidates.length > 1) {
            from = candidates.find(p => {
                const f = 'abcdefgh'[p.c];
                const rk = String(8 - p.r);
                if (prefix.length === 2) return f === prefix[0] && rk === prefix[1];
                if (/[a-h]/.test(prefix)) return f === prefix;
                if (/[1-8]/.test(prefix)) return rk === prefix;
                return false;
            }) || from;
        }
        return eng.makeMove(from, { r: toRow, c: toCol }, promoPiece);
    }
};

// ============================================================
//  SAN GENERATOR (for move display)
// ============================================================
function toSAN(eng, move, beforeFen) {
    const tmp = new ChessEngine(beforeFen);
    const { from, to, isCastle, isEnPassant } = move;
    const piece = tmp.board[from.r][from.c];
    if (!piece) return '?';

    if (isCastle === 'K' || isCastle === 'k') return 'O-O';
    if (isCastle === 'Q' || isCastle === 'q') return 'O-O-O';

    const FILES = 'abcdefgh';
    const toSq = FILES[to.c] + (8 - to.r);
    const fromSq = FILES[from.c] + (8 - from.r);
    const isCapture = !!tmp.board[to.r][to.c] || isEnPassant;
    let san = '';

    if (piece.type === 'p') {
        san = isCapture ? FILES[from.c] + 'x' + toSq : toSq;
        if (move.promoPiece && (to.r === 0 || to.r === 7)) san += '=' + move.promoPiece.toUpperCase();
    } else {
        san = piece.type.toUpperCase();
        // Disambiguation
        const others = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = tmp.board[r][c];
                if (p && p.type === piece.type && p.color === piece.color && !(r === from.r && c === from.c)) {
                    if (tmp.getLegalMoves(r, c).some(m => m.to.r === to.r && m.to.c === to.c)) {
                        others.push({ r, c });
                    }
                }
            }
        }
        if (others.length) {
            const sameFile = others.some(p => p.c === from.c);
            const sameRank = others.some(p => p.r === from.r);
            if (!sameFile) san += FILES[from.c];
            else if (!sameRank) san += (8 - from.r);
            else san += fromSq;
        }
        if (isCapture) san += 'x';
        san += toSq;
    }

    // Check / Checkmate
    tmp.makeMove(from, to, move.promoPiece || 'q');
    if (tmp.isCheckmate()) san += '#';
    else if (tmp.isInCheck(tmp.turn)) san += '+';

    return san;
}

// ============================================================
//  CAPTURED PIECES
// ============================================================
function getCaptured(eng) {
    const INIT = { p:8, n:2, b:2, r:2, q:1 };
    const cnt = { w:{p:0,n:0,b:0,r:0,q:0}, b:{p:0,n:0,b:0,r:0,q:0} };
    for (let r=0;r<8;r++) for (let c=0;c<8;c++) {
        const p = eng.board[r][c];
        if (p && cnt[p.color][p.type] !== undefined) cnt[p.color][p.type]++;
    }
    const capturedByWhite=[]; // black pieces white took
    const capturedByBlack=[]; // white pieces black took
    for (const t of ['q','r','b','n','p']) {
        const bMiss = INIT[t] - cnt.b[t];
        const wMiss = INIT[t] - cnt.w[t];
        for (let i=0;i<Math.max(0,bMiss);i++) capturedByWhite.push({color:'b',type:t});
        for (let i=0;i<Math.max(0,wMiss);i++) capturedByBlack.push({color:'w',type:t});
    }
    return { capturedByWhite, capturedByBlack };
}

// ============================================================
//  ONLINE MULTIPLAYER (PeerJS)
// ============================================================
const Online = (() => {
    let peer = null;
    let conn = null;
    let myColor = null;
    let roomId = null;
    let joinTimer = null;
    const callbacks = { move: null, start: null, connect: null, disconnect: null };

    function genRoomId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let id = '';
        for (let i = 0; i < 6; i++) id += chars[Math.floor(Math.random() * chars.length)];
        return id;
    }

    function destroyPeer() {
        clearJoinTimer();
        if (conn) { try { conn.close(); } catch(e){} conn = null; }
        if (peer) { try { peer.destroy(); } catch(e){} peer = null; }
        myColor = null; roomId = null;
    }

    function clearJoinTimer() {
        if (joinTimer) { clearTimeout(joinTimer); joinTimer = null; }
    }

    function createGame() {
        return new Promise((resolve, reject) => {
            destroyPeer();
            roomId = genRoomId();
            peer = new Peer('chess2p-' + roomId);
            peer.on('open', () => resolve(roomId));
            peer.on('connection', (c) => {
                conn = c;
                setupConn();
                if (callbacks.connect) callbacks.connect('w');
            });
            peer.on('error', (err) => {
                clearJoinTimer();
                reject(err);
            });
        });
    }

    function joinGame(code) {
        return new Promise((resolve, reject) => {
            destroyPeer();
            let settled = false; // only resolve/reject once

            const fail = (err) => {
                if (settled) return;
                settled = true;
                clearJoinTimer();
                destroyPeer();
                reject(err);
            };

            roomId = code.toUpperCase().trim();
            peer = new Peer();
            peer.on('open', () => {
                conn = peer.connect('chess2p-' + roomId);
                myColor = 'b';
                conn.on('open', () => {
                    if (settled) return;
                    settled = true;
                    clearJoinTimer();
                    setupConn();
                    resolve();
                    if (callbacks.connect) callbacks.connect('b');
                });
                conn.on('error', fail);
            });
            peer.on('error', fail);

            joinTimer = setTimeout(() => fail(new Error('Connection timed out')), 15000);
        });
    }

    function setupConn() {
        conn.on('data', (data) => {
            if (data.type === 'move' && callbacks.move) callbacks.move(data);
            if (data.type === 'start' && callbacks.start) callbacks.start();
        });
        conn.on('close', () => {
            clearJoinTimer();
            if (callbacks.disconnect) callbacks.disconnect();
        });
        conn.on('error', () => {
            clearJoinTimer();
            if (callbacks.disconnect) callbacks.disconnect();
        });
    }

    function sendMove(from, to, promoPiece) {
        if (conn && conn.open) {
            conn.send({ type: 'move', from, to, promoPiece });
        }
    }

    /** Ask the opponent to start the game (host → guest). */
    function sendStart() {
        if (conn && conn.open) {
            conn.send({ type: 'start' });
        }
    }

    function setMyColor(c) { myColor = c; }
    function getMyColor()  { return myColor; }
    function getRoomId()   { return roomId; }
    function isConnected() { return !!(conn && conn.open); }

    function disconnect() {
        destroyPeer();
    }

    function onMove(cb)       { callbacks.move = cb; }
    function onStart(cb)      { callbacks.start = cb; }
    function onConnect(cb)    { callbacks.connect = cb; }
    function onDisconnect(cb) { callbacks.disconnect = cb; }

    return {
        createGame, joinGame,
        sendMove, sendStart,
        setMyColor, getMyColor, getRoomId, isConnected, disconnect,
        onMove, onStart, onConnect, onDisconnect
    };
})();

// ============================================================
//  MAIN APP
// ============================================================
const App = (() => {
    // ----- State -----
    let engine        = new ChessEngine();
    let sanHistory    = [];
    let fenHistory    = [new ChessEngine().generateFen()];
    let selectedSq    = null;
    let validMoves    = [];
    let lastMove      = null;
    let gameOver      = false;
    let promoPending  = null;   // { from, to }
    let onlineMode    = false;  // true when playing online
    let onlineGameStarted = false; // guard against double-start
    let pgnParsed     = null;   // { headers, moves, sans, fens }

    let playerNames = { w: 'Player 1', b: 'Player 2' };
    let boardOrientation = 'w'; // 'w' (white bottom) or 'b' (black bottom)
    let gameOverReason = null;  // 'checkmate' | 'stalemate' | 'draw' | 'disconnect'

    // Piece image cache (fix flicker)
    const pieceImgCache = {};

    // ---- State Persistence (localStorage + URL) ----
    const STORAGE_KEY = 'chess2p_state';

    function saveState() {
        const state = {
            fen: engine.generateFen(),
            sanHistory: [...sanHistory],
            fenHistory: [...fenHistory],
            playerNames: { ...playerNames },
            boardOrientation,
            onlineMode,
            myColor: Online.getMyColor(),
            roomId: Online.getRoomId()
        };
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
        } catch(e) {}
    }

    function loadState() {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const state = JSON.parse(saved);
                return state;
            }
        } catch(e) {}
        return null;
    }

    function clearState() {
        try {
            localStorage.removeItem(STORAGE_KEY);
        } catch(e) {}
    }

    // Restore state on page load
    function restoreFromState(state) {
        if (!state) return false;
        
        engine = new ChessEngine(state.fen);
        sanHistory = state.sanHistory || [];
        fenHistory = state.fenHistory || [new ChessEngine().generateFen()];
        playerNames = state.playerNames || { w: 'Player 1', b: 'Player 2' };
        boardOrientation = state.boardOrientation || 'w';

        // Update name inputs
        document.getElementById('white-name').value = playerNames.w;
        document.getElementById('black-name').value = playerNames.b;

        // If there was an online game, try to reconnect
        if (state.onlineMode && state.roomId) {
            onlineMode = true;
            onlineStatusBar.innerHTML = `<span class="dot-online"></span> Reconnecting...`;
            // Try to rejoin as the same color
            Online.joinGame(state.roomId).then(() => {
                Online.setMyColor(state.myColor);
                showToast('Reconnected to game!', 'ok');
            }).catch(() => {
                onlineMode = false;
                onlineStatusBar.innerHTML = `<span class="dot-offline"></span> Offline`;
                showToast('Could not reconnect', 'err');
            });
        }

        renderBoard();
        updateStatus();
        updateMoveHistory();
        switchToMovesTab();
        return true;
    }

    // ----- DOM -----
    const boardEl        = document.getElementById('chessboard');
    const topName        = document.getElementById('top-name');
    const bottomName     = document.getElementById('bottom-name');
    const topCaptured    = document.getElementById('top-captured');
    const bottomCaptured = document.getElementById('bottom-captured');
    const topCheck       = document.getElementById('top-check');
    const botCheck       = document.getElementById('bottom-check');
    const topBar         = document.getElementById('top-player-bar');
    const botBar         = document.getElementById('bottom-player-bar');
    const topKing        = document.getElementById('top-king');
    const botKing        = document.getElementById('bottom-king');
    const gameBadge      = document.getElementById('game-badge');
    const turnText       = document.getElementById('turn-indicator') || document.getElementById('turn-text');
    const moveTbody      = document.getElementById('move-tbody');
    const toast          = document.getElementById('toast');
    const onlineStatusBar = document.getElementById('online-status-bar');

    // ---- Piece image loader with preloading ----
    let imagesPreloaded = false;
    
    function preloadPieceImages() {
        const colors = ['w', 'b'];
        const types = ['p', 'n', 'b', 'r', 'q', 'k'];
        const promises = [];
        
        colors.forEach(color => {
            types.forEach(type => {
                const key = color + type;
                const img = new Image();
                img.className = 'piece-img';
                img.draggable = false;
                img.alt = key;
                
                const p = new Promise((resolve) => {
                    img.onload = () => {
                        pieceImgCache[key] = img;
                        resolve();
                    };
                    img.onerror = () => {
                        // Try fallback
                        img.src = pieceImgSrc(color, type, true);
                        img.onerror = () => {
                            // Mark as failed - will use unicode
                            pieceImgCache[key] = null;
                            resolve();
                        };
                    };
                });
                
                img.src = pieceImgSrc(color, type, false);
                promises.push(p);
            });
        });
        
        return Promise.all(promises);
    }
    
    function makePieceImg(color, type) {
        const key = color + type;
        const cached = pieceImgCache[key];
        
        if (cached && cached.tagName === 'IMG') {
            const img = document.createElement('img');
            img.className = 'piece-img';
            img.draggable = false;
            img.alt = key;
            img.src = cached.src;
            return img;
        }
        
        // Fallback to unicode if image failed to load
        const span = document.createElement('span');
        span.className = 'piece-img';
        span.style.cssText = `font-size:calc(var(--sq)*0.78);line-height:1;pointer-events:none;z-index:2;position:relative;color:${color==='w'?'#fff':'#1a1a1a'};text-shadow:${color==='w'?'0 0 2px #000,0 1px 4px rgba(0,0,0,0.9)':'0 0 2px rgba(255,255,255,0.4)'};display:flex;align-items:center;justify-content:center;`;
        span.textContent = UNICODE_PIECES[key] || '';
        return span;
    }

    // ---- Board Rendering ----
    function renderBoard() {
        boardEl.innerHTML = '';
        const FILES = 'abcdefgh';

        // Board orientation: flip if black is at bottom
        const rowStart = boardOrientation === 'w' ? 0 : 7;
        const rowDir   = boardOrientation === 'w' ? 1 : -1;
        const colStart = boardOrientation === 'w' ? 0 : 7;
        const colDir   = boardOrientation === 'w' ? 1 : -1;

        for (let i = 0; i < 8; i++) {
            const rowIdx = boardOrientation === 'w' ? i : 7 - i;
            for (let j = 0; j < 8; j++) {
                const colIdx = boardOrientation === 'w' ? j : 7 - j;
                const r = rowIdx;
                const c = colIdx;

                const sq = document.createElement('div');
                const isLight = (r + c) % 2 === 0;
                sq.className = 'sq ' + (isLight ? 'light' : 'dark');
                sq.dataset.r = r;
                sq.dataset.c = c;

                // Rank number (left edge)
                if (colIdx === 0) {
                    const span = document.createElement('span');
                    span.className = 'sq-rank';
                    span.textContent = 8 - r;
                    sq.appendChild(span);
                }
                // File letter (bottom edge)
                if (rowIdx === 7) {
                    const span = document.createElement('span');
                    span.className = 'sq-file';
                    span.textContent = FILES[c];
                    sq.appendChild(span);
                }

                // Highlights
                if (selectedSq && selectedSq.r === r && selectedSq.c === c) sq.classList.add('sel');
                if (lastMove) {
                    if (lastMove.from.r === r && lastMove.from.c === c) sq.classList.add('last-from');
                    if (lastMove.to.r   === r && lastMove.to.c   === c) sq.classList.add('last-to');
                }
                // Valid move hints
                if (validMoves.some(m => m.to.r === r && m.to.c === c)) {
                    const target = engine.board[r][c];
                    sq.classList.add(target ? 'vc' : 'vm');
                }
                // King in check
                const p = engine.board[r][c];
                if (p && p.type === 'k' && engine.isInCheck(p.color)) {
                    sq.classList.add('in-check');
                }

                // Piece
                if (p) {
                    sq.appendChild(makePieceImg(p.color, p.type));
                }

                sq.addEventListener('click', () => onSquareClick(r, c));
                boardEl.appendChild(sq);
            }
        }

        updatePlayerUI();
        updateCheckIndicators();
    }

    // ---- Square click ----
    function onSquareClick(r, c) {
        if (gameOver || promoPending) return;

        // Online mode: only move if it's your turn and your color
        if (onlineMode) {
            const myColor = Online.getMyColor();
            if (engine.turn !== myColor) return; // not your turn
        }

        const piece = engine.board[r][c];

        if (selectedSq) {
            const mv = validMoves.find(m => m.to.r === r && m.to.c === c);
            if (mv) { attemptMove(selectedSq, { r, c }); return; }
            if (piece && piece.color === engine.turn) { selectSq(r, c); return; }
            selectedSq = null; validMoves = []; renderBoard(); return;
        }

        if (piece && piece.color === engine.turn) selectSq(r, c);
    }

    function selectSq(r, c) {
        selectedSq = { r, c };
        validMoves = engine.getLegalMoves(r, c);
        renderBoard();
    }

    // ---- Move execution ----
    function attemptMove(from, to) {
        const piece = engine.board[from.r][from.c];
        const isPromo = piece.type === 'p' &&
            ((piece.color === 'w' && to.r === 0) || (piece.color === 'b' && to.r === 7));

        if (isPromo) {
            promoPending = { from, to };
            showPromoModal(piece.color);
        } else {
            doMove(from, to, 'q');
        }
    }

    function doMove(from, to, promoPiece, isRemote = false) {
        const beforeFen = engine.generateFen();
        const lm = engine.getLegalMoves(from.r, from.c);
        const mv = lm.find(m => m.to.r === to.r && m.to.c === to.c);
        if (!mv) return;

        const hadCapture = !!engine.board[to.r][to.c] || mv.isEnPassant;
        mv.promoPiece = promoPiece;
        const san = toSAN(engine, mv, beforeFen);
        engine.makeMove(from, to, promoPiece);

        // Sound feedback
        if (engine.isInCheck(engine.turn)) sounds.playCheck();
        else if (hadCapture) sounds.playCapture();
        else sounds.playMove();

        lastMove = mv;
        selectedSq = null;
        validMoves = [];
        promoPending = null;
        sanHistory.push(san);
        fenHistory.push(engine.generateFen());

        renderBoard();
        updateStatus();
        updateMoveHistory();

        // Send to online opponent
        if (onlineMode && !isRemote) {
            Online.sendMove(from, to, promoPiece);
        }

        // Save state for refresh persistence
        saveState();

        // End conditions — single scan covers checkmate, stalemate, 50-move
        // and insufficient-material draws.
        const endState = engine.getGameState();
        if (endState.state === 'checkmate') {
            const winner = engine.turn === 'w' ? playerNames.b : playerNames.w;
            setTimeout(() => showGameOver('checkmate', winner), 350);
        } else if (endState.state === 'stalemate') {
            setTimeout(() => showGameOver('stalemate', null), 350);
        } else if (endState.state === 'draw') {
            const reason = engine.isFiftyMoveDraw() ? '50-move rule' : 'insufficient material';
            setTimeout(() => showGameOver('draw', null, reason), 350);
        }
    }

    // ---- Status update ----
    function updateStatus() {
        if (gameOver) return;
        const cur = engine.turn;
        const name = playerNames[cur];
        const label = cur === 'w' ? 'White' : 'Black';

        // Single scan covers checkmate, stalemate, 50-move and
        // insufficient-material draws — keeps badge/text consistent.
        const st = engine.getGameState();

        if (st.state === 'checkmate') {
            gameBadge.className = 'gbadge badge-over';
            gameBadge.textContent = 'Checkmate';
            if (turnText) turnText.textContent = '';
            gameOver = true;
        } else if (st.state === 'stalemate') {
            gameBadge.className = 'gbadge badge-over';
            gameBadge.textContent = 'Draw';
            if (turnText) turnText.textContent = 'Stalemate';
            gameOver = true;
        } else if (st.state === 'draw') {
            gameBadge.className = 'gbadge badge-over';
            gameBadge.textContent = 'Draw';
            if (turnText) turnText.textContent = engine.isFiftyMoveDraw() ? '50-move rule' : 'Insufficient material';
            gameOver = true;
        } else if (engine.isInCheck(cur)) {
            gameBadge.className = 'gbadge badge-check';
            gameBadge.textContent = 'Check!';
            if (turnText) turnText.textContent = `${name} in check`;
        } else {
            gameBadge.className = 'gbadge badge-play';
            gameBadge.textContent = 'Playing';
            if (turnText) turnText.textContent = `${name}'s turn (${label})`;
        }
    }

    function updatePlayerUI() {
        // White always at bottom, black at top when boardOrientation === 'w'
        const whiteOnBottom = boardOrientation === 'w';

        topName.textContent = whiteOnBottom ? playerNames.b : playerNames.w;
        bottomName.textContent = whiteOnBottom ? playerNames.w : playerNames.b;

        topKing.textContent = whiteOnBottom ? '♚' : '♔';
        botKing.textContent = whiteOnBottom ? '♔' : '♚';

        // Active turn highlight
        const whiteToMove = engine.turn === 'w';
        // If white is on bottom, highlight bottom bar when white's turn
        if (whiteOnBottom) {
            topBar.classList.toggle('player-bar-active', !whiteToMove);
            botBar.classList.toggle('player-bar-active', whiteToMove);
        } else {
            // Flipped: top bar is white, bottom bar is black
            topBar.classList.toggle('player-bar-active', whiteToMove);
            botBar.classList.toggle('player-bar-active', !whiteToMove);
        }

        // Captured pieces
        const { capturedByWhite, capturedByBlack } = getCaptured(engine);
        if (whiteOnBottom) {
            // Bottom = white, top = black
            bottomCaptured.innerHTML = capturedByWhite.map(p =>
                `<img src="${pieceImgSrc(p.color, p.type, false)}" style="width:14px;height:14px;object-fit:contain;" onerror="this.style.display='none'">`
            ).join('');
            topCaptured.innerHTML = capturedByBlack.map(p =>
                `<img src="${pieceImgSrc(p.color, p.type, false)}" style="width:14px;height:14px;object-fit:contain;" onerror="this.style.display='none'">`
            ).join('');
        } else {
            // Flipped: bottom = black, top = white
            bottomCaptured.innerHTML = capturedByBlack.map(p =>
                `<img src="${pieceImgSrc(p.color, p.type, false)}" style="width:14px;height:14px;object-fit:contain;" onerror="this.style.display='none'">`
            ).join('');
            topCaptured.innerHTML = capturedByWhite.map(p =>
                `<img src="${pieceImgSrc(p.color, p.type, false)}" style="width:14px;height:14px;object-fit:contain;" onerror="this.style.display='none'">`
            ).join('');
        }
    }

    function updateCheckIndicators() {
        const wCheck = engine.isInCheck('w');
        const bCheck = engine.isInCheck('b');
        // White at bottom, black at top
        botCheck.classList.toggle('hidden', !wCheck);
        topCheck.classList.toggle('hidden', !bCheck);
    }

    // ---- Move history ----
    function updateMoveHistory() {
        moveTbody.innerHTML = '';
        if (!sanHistory.length) {
            moveTbody.innerHTML = '<tr class="empty-row"><td colspan="3">No moves yet</td></tr>';
            return;
        }
        for (let i = 0; i < sanHistory.length; i += 2) {
            const n = Math.floor(i / 2) + 1;
            const wSan = sanHistory[i] || '';
            const bSan = sanHistory[i + 1] || '';
            const isLastW = i === sanHistory.length - 1;
            const isLastB = i + 1 === sanHistory.length - 1;
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${n}</td>
                <td class="${isLastW ? 'cur' : ''}">${wSan}</td>
                <td class="${isLastB && bSan ? 'cur' : ''}">${bSan}</td>
            `;
            moveTbody.appendChild(tr);
        }
        const scroll = moveTbody.closest('.move-list-scroll');
        if (scroll) scroll.scrollTop = scroll.scrollHeight;
    }

    // ---- New game ----
    function newGame(startFen = null) {
        engine     = startFen ? new ChessEngine(startFen) : new ChessEngine();
        sanHistory = [];
        fenHistory = [engine.generateFen()];
        selectedSq = null;
        validMoves = [];
        lastMove   = null;
        gameOver   = false;
        promoPending = null;
        clearState(); // Clear saved state on new game

        // Hide any leftover promotion / game-over overlays
        const promoModal = document.getElementById('promo-modal');
        if (promoModal) promoModal.classList.add('hidden');
        const promoGrid = document.getElementById('promo-grid');
        if (promoGrid) promoGrid.innerHTML = '';
        const goModal = document.getElementById('go-modal');
        if (goModal) goModal.classList.add('hidden');

        renderBoard();
        updateStatus();
        updateMoveHistory();
    }

    // ---- Undo ----
    function undoMove() {
        if (sanHistory.length === 0) { showToast('Nothing to undo', 'err'); return; }
        sanHistory.pop();
        fenHistory.pop();
        engine = new ChessEngine(fenHistory[fenHistory.length - 1]);
        lastMove = null; selectedSq = null; validMoves = []; gameOver = false;
        renderBoard(); updateStatus(); updateMoveHistory();
        showToast('Move undone', 'ok');
    }

    // ---- Copy PGN ----
    function copyPGN() {
        const date = new Date().toISOString().slice(0, 10);
        const tags = [
            `[Event "Local Game"]`,
            `[Date "${date}"]`,
            `[White "${playerNames.w}"]`,
            `[Black "${playerNames.b}"]`,
            `[Result "*"]`,
            ''
        ];
        let moves = '';
        for (let i = 0; i < sanHistory.length; i++) {
            if (i % 2 === 0) moves += `${Math.floor(i / 2) + 1}. `;
            moves += sanHistory[i] + ' ';
        }
        const pgn = tags.join('\n') + (moves.trim() || '*') + ' *';
        navigator.clipboard.writeText(pgn)
            .then(() => showToast('PGN copied!', 'ok'))
            .catch(() => showToast('Copy failed', 'err'));
    }

    // ---- Promotion modal ----
    function showPromoModal(color) {
        const modal = document.getElementById('promo-modal');
        const grid  = document.getElementById('promo-grid');
        modal.classList.remove('hidden');
        grid.innerHTML = '';
        const pieces = [
            { type:'q', label:'Queen' }, { type:'r', label:'Rook' },
            { type:'b', label:'Bishop' }, { type:'n', label:'Knight' }
        ];
        pieces.forEach(({ type, label }) => {
            const btn = document.createElement('button');
            btn.className = 'promo-btn';
            const img = makePieceImg(color, type);
            img.style.width = '48px';
            img.style.height = '48px';
            const span = document.createElement('span');
            span.textContent = label;
            btn.appendChild(img);
            btn.appendChild(span);
            btn.onclick = () => {
                modal.classList.add('hidden');
                doMove(promoPending.from, promoPending.to, type);
            };
            grid.appendChild(btn);
        });
    }

    // ---- Game over modal ----
    function showGameOver(type, winner, reason) {
        gameOver = true;
        gameOverReason = type;
        const modal = document.getElementById('go-modal');
        const icon  = document.getElementById('go-icon');
        const title = document.getElementById('go-title');
        const sub   = document.getElementById('go-sub');
        const normalBtns = document.getElementById('go-btn-row-normal');
        const disconnectBtns = document.getElementById('go-btn-row-disconnect');

        if (type === 'disconnect') {
            icon.textContent  = '📡';
            title.textContent = 'Disconnected';
            sub.textContent   = 'Your opponent left the game.';
            normalBtns.classList.add('hidden');
            disconnectBtns.classList.remove('hidden');
            gameBadge.className = 'gbadge badge-over';
            gameBadge.textContent = 'Game Over';
            modal.classList.remove('hidden');
            return;
        }

        // Show normal buttons for non-disconnect
        normalBtns.classList.remove('hidden');
        disconnectBtns.classList.add('hidden');

        if (type === 'checkmate') {
            icon.textContent  = '♛';
            title.textContent = 'Checkmate!';
            sub.textContent   = `${winner} wins the game!`;
        } else {
            icon.textContent  = '🤝';
            title.textContent = 'Draw!';
            if (type === 'stalemate') {
                sub.textContent = 'Stalemate — no legal moves available.';
            } else if (type === 'draw') {
                sub.textContent = reason ? `${reason} — the game is drawn.` : "It's a draw!";
            } else {
                sub.textContent = "It's a draw!";
            }
        }

        gameBadge.className = 'gbadge badge-over';
        gameBadge.textContent = type === 'checkmate' ? 'Checkmate' : 'Draw';
        modal.classList.remove('hidden');
    }

    // ---- Toast ----
    let toastTimer;
    function showToast(msg, type = '') {
        toast.textContent = msg;
        toast.className = 'toast show' + (type ? ' t-' + type : '');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toast.className = 'toast hidden', 2600);
    }

    // ---- Tab switching (right panel) ----
    function setupTabs() {
        document.querySelectorAll('.ptab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.ptab-content').forEach(c => c.classList.remove('active'));
                tab.classList.add('active');
                const target = document.getElementById(tab.dataset.tab);
                if (target) target.classList.add('active');
            });
        });
    }

    // ============================================================
    //  PGN PANEL
    // ============================================================
    function setupPGNPanel() {
        const dropZone  = document.getElementById('pgn-drop');
        const fileInput = document.getElementById('pgn-file');
        const textarea  = document.getElementById('pgn-text');
        const preview   = document.getElementById('pgn-preview');
        const metaTags  = document.getElementById('pgn-meta-tags');
        const slider    = document.getElementById('pgn-slider');
        const sliderLbl = document.getElementById('slider-val-label');
        const sliderDesc = document.getElementById('slider-desc');
        const errBox    = document.getElementById('pgn-err');
        const btnBrowse = document.getElementById('btn-pgn-browse');
        const btnClear  = document.getElementById('btn-pgn-clear');
        const btnLoad   = document.getElementById('btn-pgn-load');

        btnBrowse.addEventListener('click', () => fileInput.click());
        fileInput.addEventListener('change', e => {
            const f = e.target.files[0];
            if (!f) return;
            const rd = new FileReader();
            rd.onload = ev => { textarea.value = ev.target.result; parsePGN(ev.target.result); };
            rd.readAsText(f);
        });

        dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
        dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
        dropZone.addEventListener('drop', e => {
            e.preventDefault(); dropZone.classList.remove('dragover');
            const f = e.dataTransfer.files[0];
            if (f) { const rd = new FileReader(); rd.onload = ev => { textarea.value = ev.target.result; parsePGN(ev.target.result); }; rd.readAsText(f); }
        });

        textarea.addEventListener('input', () => parsePGN(textarea.value));

        slider.addEventListener('input', () => updateSlider(parseInt(slider.value)));

        btnClear.addEventListener('click', () => {
            textarea.value = '';
            pgnParsed = null;
            preview.classList.add('hidden');
            errBox.classList.add('hidden');
            btnLoad.disabled = true;
            fileInput.value = '';
            showToast('Cleared');
        });

        btnLoad.addEventListener('click', () => {
            if (!pgnParsed) return;
            // Show the PGN load modal to ask Local/Online + player color
            showPGNLoadModal();
        });

        // PGN Load Modal Logic
        const pgnLoadModal = document.getElementById('pgn-load-modal');
        const closePgnLoad = document.getElementById('close-pgn-load');
        const pgnStep1 = document.getElementById('pgn-load-step1');
        const pgnStep2 = document.getElementById('pgn-load-step2');
        const pgnStep3 = document.getElementById('pgn-load-step3');
        const pgnLoadLocal = document.getElementById('pgn-load-local');
        const pgnLoadOnline = document.getElementById('pgn-load-online');
        const pgnPickWhite = document.getElementById('pgn-pick-white');
        const pgnPickBlack = document.getElementById('pgn-pick-black');
        const pgnRoomCode = document.getElementById('pgn-room-code');
        const pgnShareLink = document.getElementById('pgn-share-link');
        const btnCopyPgnLink = document.getElementById('btn-copy-pgn-link');
        const btnCancelPgnWait = document.getElementById('btn-cancel-pgn-wait');

        let pgnLoadMode = null; // 'local' or 'online'
        let pgnPlayerColor = null; // 'w' or 'b'

        function showPGNLoadModal() {
            pgnLoadModal.classList.remove('hidden');
            pgnStep1.classList.remove('hidden');
            pgnStep2.classList.add('hidden');
            pgnStep3.classList.add('hidden');
            pgnLoadMode = null;
            pgnPlayerColor = null;
        }

        function hidePGNLoadModal() {
            pgnLoadModal.classList.add('hidden');
        }

        closePgnLoad.addEventListener('click', hidePGNLoadModal);
        pgnLoadModal.addEventListener('click', e => { if (e.target === pgnLoadModal) hidePGNLoadModal(); });

        // Local game - load directly
        pgnLoadLocal.addEventListener('click', () => {
            pgnLoadMode = 'local';
            hidePGNLoadModal();
            loadPGNGame();
        });

        // Online game - ask which player
        pgnLoadOnline.addEventListener('click', () => {
            pgnLoadMode = 'online';
            pgnStep1.classList.add('hidden');
            pgnStep2.classList.remove('hidden');
        });

        // Pick white
        pgnPickWhite.addEventListener('click', () => {
            pgnPlayerColor = 'w';
            startPGNOnline();
        });

        // Pick black
        pgnPickBlack.addEventListener('click', () => {
            pgnPlayerColor = 'b';
            startPGNOnline();
        });

        async function startPGNOnline() {
            pgnStep2.classList.add('hidden');
            pgnStep3.classList.remove('hidden');
            pgnRoomCode.textContent = '……';

            try {
                const code = await Online.createGame();
                Online.setMyColor(pgnPlayerColor);
                pgnRoomCode.textContent = code;
                const link = window.location.origin + window.location.pathname + '?room=' + code;
                pgnShareLink.value = link;

                // Load the PGN game locally first
                loadPGNGame();

                // The onConnect callback will handle when opponent joins
            } catch(e) {
                hidePGNLoadModal();
                showToast('Failed to create game: ' + e.message, 'err');
            }
        }

        // Handle opponent joining PGN online game
        Online.onConnect((assignedColor) => {
            // If we're in PGN online mode, close the modal and show game
            if (pgnLoadMode === 'online') {
                hidePGNLoadModal();
                onlineMode = true;
                onlineStatusBar.innerHTML = `<span class="dot-online"></span> Online`;
                gameBadge.className = 'gbadge badge-online';
                gameBadge.textContent = 'Online';
                
                // Board orientation already set based on pgnPlayerColor
                renderBoard();
                updateStatus();
                
                showToast('Opponent connected! Game started.', 'ok');
            }
        });

        // Copy link
        if (btnCopyPgnLink) {
            btnCopyPgnLink.addEventListener('click', () => {
                navigator.clipboard.writeText(pgnShareLink.value)
                    .then(() => showToast('Link copied!', 'ok'))
                    .catch(() => showToast('Copy failed', 'err'));
            });
        }

        // Cancel waiting
        btnCancelPgnWait.addEventListener('click', () => {
            Online.disconnect();
            hidePGNLoadModal();
            pgnLoadMode = null;
            pgnPlayerColor = null;
        });

        function loadPGNGame() {
            if (!pgnParsed) return;
            const at = parseInt(slider.value);
            try {
                const { eng, sans, fens } = PGN.replay(pgnParsed.moves, at);
                engine     = eng;
                sanHistory = [...sans];
                fenHistory = [...fens];
                lastMove   = null; selectedSq = null; validMoves = []; gameOver = false;

                // Auto-fill player names from PGN headers
                if (pgnParsed.headers.White && pgnParsed.headers.White !== '?') {
                    playerNames.w = pgnParsed.headers.White;
                    document.getElementById('white-name').value = playerNames.w;
                }
                if (pgnParsed.headers.Black && pgnParsed.headers.Black !== '?') {
                    playerNames.b = pgnParsed.headers.Black;
                    document.getElementById('black-name').value = playerNames.b;
                }

                // Flip board if playing online as black
                if (pgnLoadMode === 'online' && pgnPlayerColor === 'b') {
                    boardOrientation = 'b';
                } else {
                    boardOrientation = 'w';
                }

                renderBoard(); updateStatus(); updateMoveHistory();
                switchToMovesTab();

                if (pgnLoadMode === 'online') {
                    onlineMode = true;
                    onlineStatusBar.innerHTML = `<span class="dot-online"></span> Online`;
                    gameBadge.className = 'gbadge badge-online';
                    gameBadge.textContent = 'Online';
                    showToast('PGN loaded! Share the link with your friend.', 'ok');
                } else {
                    showToast(at === 0 ? 'Fresh start loaded' : `Resumed after move ${at}`, 'ok');
                }
            } catch (e) {
                errBox.textContent = '⚠ ' + e.message;
                errBox.classList.remove('hidden');
                hidePGNLoadModal();
            }
        }

        function parsePGN(text) {
            errBox.classList.add('hidden');
            preview.classList.add('hidden');
            btnLoad.disabled = true;
            pgnParsed = null;

            if (!text.trim()) return;
            try {
                const { headers, moves } = PGN.parse(text);
                if (!moves.length) { showErr('No moves found in PGN.'); return; }
                // Validate all moves
                PGN.replay(moves, moves.length);
                pgnParsed = { headers, moves };

                // Show meta tags
                metaTags.innerHTML = '';
                for (const k of ['White','Black','Event','Date','Result','ECO']) {
                    if (headers[k] && headers[k] !== '?') {
                        const span = document.createElement('span');
                        span.className = 'pgn-tag';
                        span.innerHTML = `<b>${k}:</b> ${headers[k]}`;
                        metaTags.appendChild(span);
                    }
                }
                const mv = document.createElement('span');
                mv.className = 'pgn-tag';
                mv.innerHTML = `<b>Moves:</b> ${moves.length}`;
                metaTags.appendChild(mv);

                slider.min = 0; slider.max = moves.length; slider.value = moves.length;
                updateSlider(moves.length);
                preview.classList.remove('hidden');
                btnLoad.disabled = false;
            } catch(e) {
                showErr('Invalid PGN: ' + e.message);
            }
        }

        function updateSlider(val) {
            if (!pgnParsed) return;
            const max = parseInt(slider.max);
            if (val === 0) {
                sliderLbl.textContent = 'Start';
                sliderDesc.textContent = 'Starting position';
            } else if (val === max) {
                sliderLbl.textContent = 'End';
                sliderDesc.textContent = `After move ${Math.ceil(val/2)} — game complete`;
            } else {
                const mn = Math.ceil(val/2);
                const side = val % 2 === 0 ? 'Black' : 'White';
                const san = pgnParsed.moves[val-1];
                sliderLbl.textContent = `Move ${mn} (${side}: ${san})`;
                sliderDesc.textContent = `Resume here — ${side} just played ${san}`;
            }
        }

        function showErr(msg) {
            errBox.textContent = '⚠ ' + msg;
            errBox.classList.remove('hidden');
            btnLoad.disabled = true;
        }
    }

    function switchToMovesTab() {
        document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.ptab-content').forEach(c => c.classList.remove('active'));
        document.querySelector('[data-tab="ptab-moves"]').classList.add('active');
        document.getElementById('ptab-moves').classList.add('active');
    }

    // ============================================================
    //  ONLINE MULTIPLAYER
    // ============================================================
    function setupOnlinePanel() {
        const modal         = document.getElementById('online-modal');
        const closeBtn      = document.getElementById('close-online');
        const viewIdle      = document.getElementById('view-idle');
        const viewWaiting   = document.getElementById('view-waiting');
        const viewConnected = document.getElementById('view-connected');

        const btnCreate     = document.getElementById('btn-create');
        const btnJoinShow   = document.getElementById('btn-join-show');
        const joinField     = document.getElementById('join-field');
        const joinCode      = document.getElementById('join-code');
        const btnJoinGo     = document.getElementById('btn-join-go');
        const roomCodeEl    = document.getElementById('room-code');
        const shareLinkEl   = document.getElementById('share-link');
        const btnCopyLink   = document.getElementById('btn-copy-link');
        const waitText      = document.getElementById('wait-text');
        const btnCancelWait = document.getElementById('btn-cancel-wait');
        const colorMsg      = document.getElementById('online-color-msg');
        const btnStartOnline = document.getElementById('btn-start-online');

        function showView(name) {
            viewIdle.classList.add('hidden');
            viewWaiting.classList.add('hidden');
            viewConnected.classList.add('hidden');
            document.getElementById('view-' + name).classList.remove('hidden');
        }

        // Close
        closeBtn.addEventListener('click', () => modal.classList.add('hidden'));
        modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });

        // CREATE GAME
        btnCreate.addEventListener('click', async () => {
            showView('waiting');
            waitText.textContent = 'Waiting for opponent…';
            roomCodeEl.textContent = '……';
            shareLinkEl.value = '';

            try {
                const code = await Online.createGame();
                Online.setMyColor('w');
                roomCodeEl.textContent = code;
                const link = window.location.origin + window.location.pathname + '?room=' + code;
                shareLinkEl.value = link;
            } catch(e) {
                showView('idle');
                showToast('Failed to create game: ' + e.message, 'err');
            }
        });

        // COPY LINK
        btnCopyLink.addEventListener('click', () => {
            navigator.clipboard.writeText(shareLinkEl.value)
                .then(() => showToast('Link copied!', 'ok'))
                .catch(() => showToast('Copy failed', 'err'));
        });

        // CANCEL WAITING
        btnCancelWait.addEventListener('click', () => {
            Online.disconnect();
            showView('idle');
        });

        // SHOW JOIN FIELD
        btnJoinShow.addEventListener('click', () => {
            joinField.classList.toggle('hidden');
            if (!joinField.classList.contains('hidden')) joinCode.focus();
        });

        // JOIN GAME
        async function doJoin() {
            const code = joinCode.value.trim().toUpperCase();
            if (code.length < 4) { showToast('Enter a valid room code', 'err'); return; }
            btnJoinGo.disabled = true;
            btnJoinGo.textContent = 'Connecting…';
            try {
                await Online.joinGame(code);
                // Connection handled by onConnect callback
            } catch(e) {
                showToast('Could not connect: ' + e.message, 'err');
                btnJoinGo.disabled = false;
                btnJoinGo.textContent = 'Connect →';
            }
        }
        btnJoinGo.addEventListener('click', doJoin);
        joinCode.addEventListener('keydown', e => { if (e.key === 'Enter') doJoin(); });

        // ---- Shared start routine (runs on BOTH peers) ----
        function startOnlineGame() {
            if (onlineGameStarted) return; // guard against double-start
            onlineGameStarted = true;

            onlineMode = true;
            const myColor = Online.getMyColor();
            // Board orientation follows your color: you always see your own pieces at the bottom
            boardOrientation = myColor;

            // Set player names based on role
            if (myColor === 'w') {
                playerNames.w = document.getElementById('white-name').value || 'Player 1';
                playerNames.b = 'Opponent';
            } else {
                playerNames.b = document.getElementById('black-name').value || 'Player 2';
                playerNames.w = 'Opponent';
            }
            document.getElementById('white-name').value = playerNames.w;
            document.getElementById('black-name').value = playerNames.b;

            modal.classList.add('hidden');
            newGame();
            updateStatus();
            showToast(`Game started! You are ${myColor === 'w' ? 'White' : 'Black'}`, 'ok');
        }

        function resetOnlineState() {
            onlineMode = false;
            onlineGameStarted = false;
            onlineStatusBar.innerHTML = `<span class="dot-offline"></span> Offline`;
        }

        // Color choice buttons
        const pickWhite = document.getElementById('pick-white');
        const pickBlack = document.getElementById('pick-black');
        const colorHint = document.getElementById('color-hint');
        const colorChosen = document.getElementById('color-chosen');
        const roomCodeEcho = document.getElementById('room-code-echo');
        const shareLinkConnected = document.getElementById('share-link-connected');
        const btnCopyLinkConnected = document.getElementById('btn-copy-link-connected');
        const btnCopyCodeEcho = document.getElementById('btn-copy-code-echo');

        function updateColorChoiceUI(chosenColor) {
            if (chosenColor === 'w') {
                pickWhite.classList.add('chosen');
                pickWhite.disabled = true;
                pickBlack.disabled = true;
                colorChosen.textContent = '✓ You are White';
                colorChosen.classList.remove('hidden');
                colorHint.classList.add('hidden');
            } else {
                pickBlack.classList.add('chosen');
                pickBlack.disabled = true;
                pickWhite.disabled = true;
                colorChosen.textContent = '✓ You are Black';
                colorChosen.classList.remove('hidden');
                colorHint.classList.add('hidden');
            }
            btnStartOnline.disabled = false;
            // Flip board if black
            boardOrientation = chosenColor;
        }

        pickWhite.addEventListener('click', () => {
            Online.setMyColor('w');
            updateColorChoiceUI('w');
        });

        pickBlack.addEventListener('click', () => {
            Online.setMyColor('b');
            updateColorChoiceUI('b');
        });

        // Copy link / code in connected view
        if (btnCopyLinkConnected) {
            btnCopyLinkConnected.addEventListener('click', () => {
                navigator.clipboard.writeText(shareLinkConnected.value)
                    .then(() => showToast('Link copied!', 'ok'))
                    .catch(() => showToast('Copy failed', 'err'));
            });
        }
        if (btnCopyCodeEcho) {
            btnCopyCodeEcho.addEventListener('click', () => {
                navigator.clipboard.writeText(roomCodeEcho.textContent)
                    .then(() => showToast('Room code copied!', 'ok'))
                    .catch(() => showToast('Copy failed', 'err'));
            });
        }

        // ONLINE CALLBACKS
        Online.onConnect((assignedColor) => {
            // assignedColor is 'w' for host, 'b' for guest
            const roomId = Online.getRoomId();
            if (roomId) {
                roomCodeEcho.textContent = roomId;
                shareLinkConnected.value = window.location.origin + window.location.pathname + '?room=' + roomId;
            }

            const colorPickHost = document.getElementById('color-pick-host');
            const colorWaitGuest = document.getElementById('color-waiting-guest');

            if (assignedColor === 'w') {
                // HOST: show color picker
                colorMsg.innerHTML = `You are the host. Choose your color:`;
                colorPickHost.classList.remove('hidden');
                colorWaitGuest.classList.add('hidden');
                // Host defaults to white, can change
                Online.setMyColor('w');
            } else {
                // GUEST: hide color picker, show waiting message
                colorMsg.innerHTML = `Waiting for host to set colors...`;
                colorPickHost.classList.add('hidden');
                colorWaitGuest.classList.remove('hidden');
                // Disable start button for guest
                btnStartOnline.disabled = true;
                btnStartOnline.textContent = 'Waiting for host...';
                // Guest is black — orient the board so black is at the bottom
                boardOrientation = 'b';
            }

            showView('connected');

            // Update online status bar
            onlineStatusBar.innerHTML = `<span class="dot-online"></span> Online`;
            gameBadge.className = 'gbadge badge-online';
            gameBadge.textContent = 'Online';
        });

        Online.onMove((data) => {
            if (gameOver) return;
            doMove(data.from, data.to, data.promoPiece || 'q', true);
        });

        // Guest receives the "ready" signal from host → start together
        Online.onStart(() => {
            startOnlineGame();
        });

        Online.onDisconnect(() => {
            if (onlineGameStarted) {
                showGameOver('disconnect', null);
            } else {
                showToast('Opponent disconnected', 'err');
            }
            resetOnlineState();
        });

        // START ONLINE GAME — the HOST starts; the guest receives the start signal
        btnStartOnline.addEventListener('click', () => {
            if (Online.getMyColor() === 'w') {
                // Host: kick off the game locally AND signal the guest
                startOnlineGame();
                Online.sendStart();
            } else {
                // Guest: just waiting for the host… button is disabled in UI
                showToast('Waiting for host to start the game…');
            }
        });

        // Auto-join from URL if ?room=CODE
        const params = new URLSearchParams(window.location.search);
        const roomFromUrl = params.get('room');
        if (roomFromUrl) {
            modal.classList.remove('hidden');
            joinField.classList.remove('hidden');
            joinCode.value = roomFromUrl.toUpperCase();
            // Auto-attempt connection after a moment
            setTimeout(() => doJoin(), 800);
        }
    }

    // ============================================================
    //  INIT
    // ============================================================
    function init() {
        // New Game modal
        const newGameModal = document.getElementById('newgame-modal');
        const closeNewGame = document.getElementById('close-newgame');
        const btnLocalGame = document.getElementById('btn-local-game');
        const btnOnlineGame = document.getElementById('btn-online-game');
        const onlineModal = document.getElementById('online-modal');

        // Open New Game modal from nav
        document.getElementById('nav-new-game').addEventListener('click', () => {
            setNavActive('nav-new-game');
            newGameModal.classList.remove('hidden');
        });

        // Close New Game modal
        closeNewGame.addEventListener('click', () => newGameModal.classList.add('hidden'));
        newGameModal.addEventListener('click', e => { if (e.target === newGameModal) newGameModal.classList.add('hidden'); });

        // Local game from New Game modal
        btnLocalGame.addEventListener('click', () => {
            newGameModal.classList.add('hidden');
            if (onlineMode) {
                Online.disconnect();
                onlineMode = false;
                onlineStatusBar.innerHTML = `<span class="dot-offline"></span> Offline`;
            }
            newGame();
            showToast('Local 2-player game started', 'ok');
        });

        // Online game from New Game modal
        btnOnlineGame.addEventListener('click', () => {
            newGameModal.classList.add('hidden');
            onlineModal.classList.remove('hidden');
            document.getElementById('view-idle').classList.remove('hidden');
            document.getElementById('view-waiting').classList.add('hidden');
            document.getElementById('view-connected').classList.add('hidden');
            document.getElementById('join-field').classList.add('hidden');
        });

        // PGN nav button
        document.getElementById('nav-pgn').addEventListener('click', () => {
            setNavActive('nav-pgn');
            // Switch to PGN tab in right panel
            document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.ptab-content').forEach(c => c.classList.remove('active'));
            document.querySelector('[data-tab="ptab-pgn"]').classList.add('active');
            document.getElementById('ptab-pgn').classList.add('active');
        });

        function setNavActive(id) {
            document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(id).classList.add('active');
        }

        // Player name inputs
        document.getElementById('white-name').addEventListener('input', e => {
            playerNames.w = e.target.value || 'Player 1';
            updatePlayerUI();
        });
        document.getElementById('black-name').addEventListener('input', e => {
            playerNames.b = e.target.value || 'Player 2';
            updatePlayerUI();
        });

        // Right panel buttons
        document.getElementById('btn-undo').addEventListener('click', undoMove);
        document.getElementById('btn-new-game').addEventListener('click', () => {
            if (onlineMode) { showToast('Cannot reset during online game', 'err'); return; }
            newGame();
            showToast('New game started', 'ok');
        });
        document.getElementById('btn-copy-pgn').addEventListener('click', copyPGN);

        // Flip board (local view toggle)
        const flipBoard = () => {
            boardOrientation = boardOrientation === 'w' ? 'b' : 'w';
            renderBoard();
        };
        const btnFlip = document.getElementById('btn-flip');
        if (btnFlip) btnFlip.addEventListener('click', flipBoard);
        const btnFlipMobile = document.getElementById('btn-flip-mobile');
        if (btnFlipMobile) btnFlipMobile.addEventListener('click', flipBoard);

        // Game over modal buttons
        document.getElementById('btn-rematch').addEventListener('click', () => {
            document.getElementById('go-modal').classList.add('hidden');
            newGame();
        });
        document.getElementById('btn-review').addEventListener('click', () => {
            document.getElementById('go-modal').classList.add('hidden');
        });
        // Undo button in game-over modal (available for local games)
        document.getElementById('btn-undo-last').addEventListener('click', () => {
            if (gameOverReason !== 'disconnect') {
                document.getElementById('go-modal').classList.add('hidden');
                undoMove();
            }
        });

        // Exit button for disconnect
        document.getElementById('btn-exit-game').addEventListener('click', () => {
            document.getElementById('go-modal').classList.add('hidden');
            Online.disconnect();
            onlineMode = false;
            onlineStatusBar.innerHTML = `<span class="dot-offline"></span> Offline`;
            newGame();
        });

        // Keyboard shortcuts
        document.addEventListener('keydown', e => {
            // Ctrl+Z for undo (works everywhere now)
            if (e.ctrlKey && e.key === 'z') {
                e.preventDefault();
                if (gameOver && gameOverReason !== 'disconnect') {
                    document.getElementById('go-modal').classList.add('hidden');
                }
                undoMove();
            }
        });

        // Setup sub-systems
        setupTabs();
        setupPGNPanel();
        setupOnlinePanel();
        setupMobileUI();
        setupSoundToggle();

        // Preload piece images, then render
        preloadPieceImages().then(() => {
            imagesPreloaded = true;
            
            // Try to restore from saved state first
            const savedState = loadState();
            if (savedState && savedState.fen && savedState.sanHistory) {
                const restored = restoreFromState(savedState);
                if (!restored) {
                    newGame();
                    updateStatus();
                }
            } else {
                newGame();
                updateStatus();
            }
        });

        // Save state before page unload
        window.addEventListener('beforeunload', () => {
            if (sanHistory.length > 0 || onlineMode) {
                saveState();
            }
        });
    }

    // ============================================================
    //  MOBILE UI — sidebar and panel drawer toggles
    // ============================================================
    function setupMobileUI() {
        const sidebar    = document.querySelector('.sidebar');
        const rightPanel = document.querySelector('.right-panel');
        const backdrop   = document.getElementById('mobile-backdrop');
        const btnSidebar = document.getElementById('mh-btn-sidebar');
        const btnPanel   = document.getElementById('mh-btn-panel');

        const isMobile = () => window.innerWidth <= 900;

        function openDrawer(drawer) {
            if (drawer === 'sidebar' && rightPanel) rightPanel.classList.remove('open');
            if (drawer === 'panel' && sidebar) sidebar.classList.remove('open');

            if (drawer === 'sidebar' && sidebar) sidebar.classList.add('open');
            if (drawer === 'panel' && rightPanel) rightPanel.classList.add('open');

            backdrop.classList.add('show');

            btnSidebar.classList.toggle('active', drawer === 'sidebar');
            btnPanel.classList.toggle('active', drawer === 'panel');
        }

        function closeDrawers() {
            if (sidebar) sidebar.classList.remove('open');
            if (rightPanel) rightPanel.classList.remove('open');
            backdrop.classList.remove('show');
            btnSidebar.classList.remove('active');
            btnPanel.classList.remove('active');
        }

        if (btnSidebar) {
            btnSidebar.addEventListener('click', () => {
                if (!isMobile()) return;
                if (sidebar.classList.contains('open')) closeDrawers();
                else openDrawer('sidebar');
            });
        }

        if (btnPanel) {
            btnPanel.addEventListener('click', () => {
                if (!isMobile()) return;
                if (rightPanel.classList.contains('open')) closeDrawers();
                else openDrawer('panel');
            });
        }

        backdrop.addEventListener('click', closeDrawers);

        window.addEventListener('resize', () => {
            if (!isMobile()) closeDrawers();
        });

        document.querySelectorAll('.nav-btn, .ab-btn, .ptab').forEach(el => {
            el.addEventListener('click', () => {
                if (isMobile()) setTimeout(() => closeDrawers(), 150);
            });
        });

        if (boardEl) {
            boardEl.addEventListener('click', () => {
                if (isMobile() && (sidebar.classList.contains('open') || rightPanel.classList.contains('open'))) {
                    closeDrawers();
                }
            });
        }
    }

    // ============================================================
    //  SOUND TOGGLE
    // ============================================================
    function setupSoundToggle() {
        const toggles = [
            document.getElementById('sound-toggle'),
            document.getElementById('sound-toggle-mobile')
        ];
        function refresh() {
            toggles.forEach(btn => {
                if (!btn) return;
                const icon = btn.querySelector('i');
                if (icon) icon.className = sounds.enabled ? 'fa-solid fa-volume-high' : 'fa-solid fa-volume-xmark';
                btn.classList.toggle('muted', !sounds.enabled);
            });
        }
        toggles.forEach(btn => {
            if (!btn) return;
            btn.addEventListener('click', () => {
                sounds.enabled = !sounds.enabled;
                refresh();
                if (sounds.enabled) sounds.playSuccess();
            });
        });
        refresh();
    }

    return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());

/**
 * Lightweight Chess Engine
 * Handles moves, castling, en passant, promotion, check, checkmate,
 * stalemate and rule-books draws (50-move + insufficient material).
 */
const CASTLE_ROOKS = {
    K: { r: 7, from: 7, to: 5 },
    Q: { r: 7, from: 0, to: 3 },
    k: { r: 0, from: 7, to: 5 },
    q: { r: 0, from: 0, to: 3 }
};

class ChessEngine {
    constructor(fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1') {
        this.reset(fen);
    }

    reset(fen) {
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));
        this.turn = 'w';          // 'w' or 'b'
        this.castling = { k: true, q: true, K: true, Q: true };
        this.epSquare = null;     // {r, c}
        this.halfMoves = 0;       // 50-move rule clock
        this.fullMoves = 1;
        this.moveHistory = [];
        if (fen) this.loadFen(fen);
    }

    loadFen(fen) {
        const parts = fen.trim().split(/\s+/);
        const rows = parts[0].split('/');
        this.board = Array(8).fill(null).map(() => Array(8).fill(null));

        for (let r = 0; r < 8; r++) {
            let c = 0;
            for (const char of rows[r]) {
                if (!isNaN(char)) {
                    c += parseInt(char, 10);
                } else {
                    const color = char === char.toUpperCase() ? 'w' : 'b';
                    this.board[r][c] = { type: char.toLowerCase(), color };
                    c++;
                }
            }
        }

        this.turn = parts[1] || 'w';

        // Castling rights are only valid if the king and matching rook are
        // actually present on their home squares (defends malformed FENs).
        const castlingStr = parts[2] || 'KQkq';
        const wk = this.board[7][4], wrK = this.board[7][7], wrQ = this.board[7][0];
        const bk = this.board[0][4], brK = this.board[0][7], brQ = this.board[0][0];
        const hasWhiteKing = !!wk && wk.type === 'k' && wk.color === 'w';
        const hasBlackKing = !!bk && bk.type === 'k' && bk.color === 'b';
        this.castling = {
            K: hasWhiteKing && castlingStr.includes('K') && !!wrK && wrK.type === 'r' && wrK.color === 'w',
            Q: hasWhiteKing && castlingStr.includes('Q') && !!wrQ && wrQ.type === 'r' && wrQ.color === 'w',
            k: hasBlackKing && castlingStr.includes('k') && !!brK && brK.type === 'r' && brK.color === 'b',
            q: hasBlackKing && castlingStr.includes('q') && !!brQ && brQ.type === 'r' && brQ.color === 'b'
        };

        // En passant: keep only squares that could actually be captured next.
        if (parts[3] && parts[3] !== '-') {
            const col = parts[3].charCodeAt(0) - 97;
            const row = 8 - parseInt(parts[3][1], 10);
            const validEp = (row === 2 && this.turn === 'w') || (row === 5 && this.turn === 'b');
            this.epSquare = validEp ? { r: row, c: col } : null;
        } else {
            this.epSquare = null;
        }

        this.halfMoves = parseInt(parts[4] || '0', 10);
        this.fullMoves = parseInt(parts[5] || '1', 10);
    }

    generateFen() {
        let fen = '';
        for (let r = 0; r < 8; r++) {
            let empty = 0;
            for (let c = 0; c < 8; c++) {
                const piece = this.board[r][c];
                if (!piece) {
                    empty++;
                } else {
                    if (empty > 0) { fen += empty; empty = 0; }
                    fen += piece.color === 'w' ? piece.type.toUpperCase() : piece.type;
                }
            }
            if (empty > 0) fen += empty;
            if (r < 7) fen += '/';
        }

        fen += ` ${this.turn} `;
        let cast = '';
        if (this.castling.K) cast += 'K';
        if (this.castling.Q) cast += 'Q';
        if (this.castling.k) cast += 'k';
        if (this.castling.q) cast += 'q';
        fen += (cast || '-') + ' ';

        if (this.epSquare) {
            fen += String.fromCharCode(97 + this.epSquare.c) + (8 - this.epSquare.r) + ' ';
        } else {
            fen += '- ';
        }
        fen += `${this.halfMoves} ${this.fullMoves}`;
        return fen;
    }

    getPiece(r, c) {
        if (r < 0 || r > 7 || c < 0 || c > 7) return null;
        return this.board[r][c];
    }

    inBounds(r, c) {
        return r >= 0 && r < 8 && c >= 0 && c < 8;
    }

    // ---------------- Move generation ----------------

    getLegalMoves(r, c) {
        const piece = this.getPiece(r, c);
        if (!piece || piece.color !== this.turn) return [];
        const pseudoMoves = this.getPseudoMoves(r, c);
        return pseudoMoves.filter(m => !this.moveLeavesKingInCheck(m));
    }

    getPseudoMoves(r, c) {
        const piece = this.getPiece(r, c);
        if (!piece) return [];
        const moves = [];
        const dir = piece.color === 'w' ? -1 : 1;
        const opp = piece.color === 'w' ? 'b' : 'w';

        switch (piece.type) {
            case 'p': {
                // Forward 1
                if (this.inBounds(r + dir, c) && !this.board[r + dir][c]) {
                    moves.push({ from: {r, c}, to: {r: r + dir, c} });
                    // Forward 2
                    const startRow = piece.color === 'w' ? 6 : 1;
                    if (r === startRow && !this.board[r + 2 * dir][c]) {
                        moves.push({ from: {r, c}, to: {r: r + 2 * dir, c}, doubleStep: true });
                    }
                }
                // Captures & En Passant
                for (const dc of [-1, 1]) {
                    const nc = c + dc;
                    if (this.inBounds(r + dir, nc)) {
                        const target = this.board[r + dir][nc];
                        if (target && target.color === opp) {
                            moves.push({ from: {r, c}, to: {r: r + dir, c: nc} });
                        } else if (this.epSquare && this.epSquare.r === r + dir && this.epSquare.c === nc) {
                            moves.push({ from: {r, c}, to: {r: r + dir, c: nc}, isEnPassant: true });
                        }
                    }
                }
                break;
            }
            case 'n': {
                const nOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
                for (const [dr, dc] of nOffsets) {
                    const nr = r + dr, nc = c + dc;
                    if (this.inBounds(nr, nc)) {
                        const target = this.board[nr][nc];
                        if (!target || target.color === opp) {
                            moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                        }
                    }
                }
                break;
            }
            case 'b':
                this.addRayMoves(moves, r, c, [[-1,-1],[-1,1],[1,-1],[1,1]]);
                break;
            case 'r':
                this.addRayMoves(moves, r, c, [[-1,0],[1,0],[0,-1],[0,1]]);
                break;
            case 'q':
                this.addRayMoves(moves, r, c, [[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
                break;
            case 'k': {
                const kOffsets = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
                for (const [dr, dc] of kOffsets) {
                    const nr = r + dr, nc = c + dc;
                    if (this.inBounds(nr, nc)) {
                        const target = this.board[nr][nc];
                        if (!target || target.color === opp) {
                            moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                        }
                    }
                }
                // Castling
                if (!this.isInCheck(piece.color)) {
                    if (piece.color === 'w') {
                        if (this.castling.K && !this.board[7][5] && !this.board[7][6] && !this.isSquareAttacked(7, 5, 'b')) {
                            moves.push({ from: {r, c}, to: {r: 7, c: 6}, isCastle: 'K' });
                        }
                        if (this.castling.Q && !this.board[7][3] && !this.board[7][2] && !this.board[7][1] && !this.isSquareAttacked(7, 3, 'b')) {
                            moves.push({ from: {r, c}, to: {r: 7, c: 2}, isCastle: 'Q' });
                        }
                    } else {
                        if (this.castling.k && !this.board[0][5] && !this.board[0][6] && !this.isSquareAttacked(0, 5, 'w')) {
                            moves.push({ from: {r, c}, to: {r: 0, c: 6}, isCastle: 'k' });
                        }
                        if (this.castling.q && !this.board[0][3] && !this.board[0][2] && !this.board[0][1] && !this.isSquareAttacked(0, 3, 'w')) {
                            moves.push({ from: {r, c}, to: {r: 0, c: 2}, isCastle: 'q' });
                        }
                    }
                }
                break;
            }
        }
        return moves;
    }

    addRayMoves(moves, r, c, directions) {
        const piece = this.getPiece(r, c);
        const opp = piece.color === 'w' ? 'b' : 'w';
        for (const [dr, dc] of directions) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const target = this.board[nr][nc];
                if (!target) {
                    moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                } else {
                    if (target.color === opp) {
                        moves.push({ from: {r, c}, to: {r: nr, c: nc} });
                    }
                    break;
                }
                nr += dr;
                nc += dc;
            }
        }
    }

    // ---------------- Attack detection ----------------

    /**
     * Efficient, ray-based attack test. Instead of scanning all 64 squares
     * this only inspects squares that could physically attack (r, c).
     */
    isSquareAttacked(r, c, attackerColor) {
        if (!this.inBounds(r, c)) return false;

        // Pawns
        const pawnDir = attackerColor === 'w' ? -1 : 1;
        for (const dc of [-1, 1]) {
            const p = this.getPiece(r - pawnDir, c + dc);
            if (p && p.color === attackerColor && p.type === 'p') return true;
        }

        // Knights
        const knightOffsets = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
        for (const [dr, dc] of knightOffsets) {
            const p = this.getPiece(r + dr, c + dc);
            if (p && p.color === attackerColor && p.type === 'n') return true;
        }

        // King
        for (let dr = -1; dr <= 1; dr++) {
            for (let dc = -1; dc <= 1; dc++) {
                if (dr === 0 && dc === 0) continue;
                const p = this.getPiece(r + dr, c + dc);
                if (p && p.color === attackerColor && p.type === 'k') return true;
            }
        }

        // Orthogonal rays — rook / queen
        for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const p = this.getPiece(nr, nc);
                if (p) {
                    if (p.color === attackerColor && (p.type === 'r' || p.type === 'q')) return true;
                    break;
                }
                nr += dr;
                nc += dc;
            }
        }

        // Diagonal rays — bishop / queen
        for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
            let nr = r + dr, nc = c + dc;
            while (this.inBounds(nr, nc)) {
                const p = this.getPiece(nr, nc);
                if (p) {
                    if (p.color === attackerColor && (p.type === 'b' || p.type === 'q')) return true;
                    break;
                }
                nr += dr;
                nc += dc;
            }
        }

        return false;
    }

    /** Kept as a small public helper: does piece p on (pr,pc) attack (tr,tc)? */
    pieceAttacksSquare(p, pr, pc, tr, tc) {
        const dr = tr - pr;
        const dc = tc - pc;
        const absDr = Math.abs(dr);
        const absDc = Math.abs(dc);

        switch (p.type) {
            case 'p': {
                const pawnDir = p.color === 'w' ? -1 : 1;
                return dr === pawnDir && absDc === 1;
            }
            case 'n':
                return (absDr === 2 && absDc === 1) || (absDr === 1 && absDc === 2);
            case 'k':
                return absDr <= 1 && absDc <= 1;
            case 'b':
                return absDr === absDc && this.isPathClear(pr, pc, tr, tc);
            case 'r':
                return (pr === tr || pc === tc) && this.isPathClear(pr, pc, tr, tc);
            case 'q':
                return (absDr === absDc || pr === tr || pc === tc) && this.isPathClear(pr, pc, tr, tc);
        }
        return false;
    }

    isPathClear(r1, c1, r2, c2) {
        const dr = Math.sign(r2 - r1);
        const dc = Math.sign(c2 - c1);
        let currR = r1 + dr;
        let currC = c1 + dc;
        while (currR !== r2 || currC !== c2) {
            if (this.board[currR][currC]) return false;
            currR += dr;
            currC += dc;
        }
        return true;
    }

    findKing(color) {
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (p && p.type === 'k' && p.color === color) return { r, c };
            }
        }
        return null;
    }

    isInCheck(color) {
        const king = this.findKing(color);
        if (!king) return false;
        const opp = color === 'w' ? 'b' : 'w';
        return this.isSquareAttacked(king.r, king.c, opp);
    }

    /**
     * Test whether a pseudo-legal move would leave the moving side's king in
     * check. Uses an apply / un-apply on the same board (no engine copies),
     * so it is fast and keeps FEN out of the hot path.
     */
    moveLeavesKingInCheck(move) {
        const { from, to, isEnPassant = false, isCastle = false } = move;
        const movingPiece = this.board[from.r][from.c];
        const capturedPiece = this.board[to.r][to.c];
        const epCaptured = isEnPassant ? this.board[from.r][to.c] : null;

        // Apply the move
        this.board[to.r][to.c] = movingPiece;
        this.board[from.r][from.c] = null;
        if (isEnPassant) this.board[from.r][to.c] = null;
        let castle = null;
        if (isCastle) {
            castle = CASTLE_ROOKS[isCastle];
            this.board[castle.r][castle.to] = this.board[castle.r][castle.from];
            this.board[castle.r][castle.from] = null;
        }

        const inCheck = this.isInCheck(movingPiece.color);

        // Undo the move
        this.board[from.r][from.c] = movingPiece;
        this.board[to.r][to.c] = capturedPiece;
        if (isEnPassant) this.board[from.r][to.c] = epCaptured;
        if (castle) {
            this.board[castle.r][castle.from] = this.board[castle.r][castle.to];
            this.board[castle.r][castle.to] = null;
        }

        return inCheck;
    }

    // ---------------- Move execution ----------------

    makeMove(from, to, promoPiece = 'q') {
        const moves = this.getLegalMoves(from.r, from.c);
        const move = moves.find(m => m.to.r === to.r && m.to.c === to.c);
        if (!move) return false;

        move.promoPiece = promoPiece;
        this.executeMove(move);
        this.moveHistory.push(move);
        return true;
    }

    executeMove(move) {
        const { from, to, isCastle = false, isEnPassant = false, doubleStep = false, promoPiece = 'q' } = move;
        const piece = this.board[from.r][from.c];
        if (!piece) return;
        const captured = this.board[to.r][to.c];

        // Move piece
        this.board[to.r][to.c] = piece;
        this.board[from.r][from.c] = null;

        // Pawn promotion
        if (piece.type === 'p' && (to.r === 0 || to.r === 7)) {
            this.board[to.r][to.c] = { type: promoPiece || 'q', color: piece.color };
        }

        // En passant capture
        if (isEnPassant) {
            const capRow = piece.color === 'w' ? to.r + 1 : to.r - 1;
            this.board[capRow][to.c] = null;
        }

        // Castling — move the rook
        if (isCastle) {
            const def = CASTLE_ROOKS[isCastle];
            this.board[def.r][def.to] = this.board[def.r][def.from];
            this.board[def.r][def.from] = null;
        }

        // Update en passant target square
        this.epSquare = doubleStep ? { r: (from.r + to.r) / 2, c: from.c } : null;

        // Castling rights — king moved
        if (piece.type === 'k') {
            if (piece.color === 'w') { this.castling.K = false; this.castling.Q = false; }
            else { this.castling.k = false; this.castling.q = false; }
        }
        // Castling rights — own rook left its home square
        if (piece.type === 'r') {
            if (from.r === 7 && from.c === 0) this.castling.Q = false;
            if (from.r === 7 && from.c === 7) this.castling.K = false;
            if (from.r === 0 && from.c === 0) this.castling.q = false;
            if (from.r === 0 && from.c === 7) this.castling.k = false;
        }
        // Castling rights — opponent rook was captured on its home square
        if (captured && captured.type === 'r') {
            if (to.r === 7 && to.c === 0) this.castling.Q = false;
            if (to.r === 7 && to.c === 7) this.castling.K = false;
            if (to.r === 0 && to.c === 0) this.castling.q = false;
            if (to.r === 0 && to.c === 7) this.castling.k = false;
        }

        // Fifty-move clock: reset on pawn moves and captures, else advance
        if (piece.type === 'p' || captured || isEnPassant) {
            this.halfMoves = 0;
        } else {
            this.halfMoves++;
        }

        // Switch turn
        this.turn = this.turn === 'w' ? 'b' : 'w';
        if (this.turn === 'w') this.fullMoves++;
    }

    getAllLegalMoves() {
        const moves = [];
        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                if (this.board[r][c] && this.board[r][c].color === this.turn) {
                    moves.push(...this.getLegalMoves(r, c));
                }
            }
        }
        return moves;
    }

    // ---------------- Game state ----------------

    isCheckmate() {
        return this.isInCheck(this.turn) && this.getAllLegalMoves().length === 0;
    }

    isStalemate() {
        return !this.isInCheck(this.turn) && this.getAllLegalMoves().length === 0;
    }

    /** 50-move rule — 100 half-moves without any pawn move or capture. */
    isFiftyMoveDraw() {
        return this.halfMoves >= 100;
    }

    /** Insufficient material — no series of legal moves can force mate. */
    isInsufficientMaterialDraw() {
        let bishops = 0;
        let knights = 0;
        let bishopSquareColor = null;

        for (let r = 0; r < 8; r++) {
            for (let c = 0; c < 8; c++) {
                const p = this.board[r][c];
                if (!p) continue;
                switch (p.type) {
                    case 'p':
                    case 'r':
                    case 'q':
                        return false; // mating material exists
                    case 'n':
                        knights++;
                        break;
                    case 'b':
                        bishops++;
                        const sq = (r + c) % 2 === 0 ? 'light' : 'dark';
                        if (bishopSquareColor === null) bishopSquareColor = sq;
                        else if (bishopSquareColor !== sq) return false; // opposite-colour bishops can mate
                        break;
                }
            }
        }

        if (bishops === 0 && knights === 0) return true;          // K vs K
        if (bishops > 0 && knights === 0) return true;            // K+B vs K (same colour)
        if (knights === 1 && bishops === 0) return true;          // K+N vs K
        return false;
    }

    /** Any rule draw (50-move or insufficient material). */
    isDraw() {
        return this.isFiftyMoveDraw() || this.isInsufficientMaterialDraw();
    }

    /**
     * Union of end states, computed with a single legal-move scan.
     * @returns {{ state: 'playing'|'checkmate'|'stalemate'|'draw', inCheck: boolean }}
     */
    getGameState() {
        const legalMoves = this.getAllLegalMoves();
        const inCheck = this.isInCheck(this.turn);

        if (legalMoves.length === 0) {
            return { state: inCheck ? 'checkmate' : 'stalemate', inCheck };
        }
        if (this.isDraw()) {
            return { state: 'draw', inCheck };
        }
        return { state: 'playing', inCheck };
    }
}
const express = require('express');
const app = express();
app.use(express.static('public'));
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.get('/', (req, res) => { res.sendFile(__dirname + '/index.html'); });

const todasLasCartas = [
    { id: 0, nombre: "Mossac", img: "mossacbanner.png", bloqueada: false, stats: [1, 0, 2, 3, 8, 9, 0, 3] },
    { id: 1, nombre: "Pleitón", img: "Pleitón.png", bloqueada: false, stats: [2, 2, 6, 7, 9, 6, 1, 4] },
    { id: 2, nombre: "Jabaleón", img: "Jabaleón.png", bloqueada: false, stats: [4, 3, 3, 6, 8, 7, 4, 5] },
    { id: 3, nombre: "Acibio", img: "Acibio.png", bloqueada: false, stats: [3, 2, 2, 4, 2, 4, 1, 8] },
    { id: 4, nombre: "Groatam", img: "Groatam.png", bloqueada: false, stats: [1, 1, 4, 5, 7, 7, 2, 5] },
    { id: 5, nombre: "skli", img: "skli.png", bloqueada: false, stats: [6, 8, 1, 9, 1, 3, 6, 9] },
    { id: 6, nombre: "Maforat", img: "Maforat.png", bloqueada: true, codigo: "JAPON", stats: [3, 0, 4, 8, 7, 8, 0, 8] },
    { id: 7, nombre: "Ossy", img: "Ossy.png", bloqueada: false, stats: [8, 9, 8, 5, 1, 2, 6, 3] },
];

const nombresAtributos = ["Inteligencia", "Astucia", "Magia", "Velocidad", "Valor", "Fuerza", "Sabiduría", "Agilidad"];

let partidas = {}; 
let jugadoresConectados = {}; 
let colaEsperaPvP = null; 

class Partida {
    constructor(id, jugador1, jugador2, esContraCPU) {
        this.id = id;
        this.jugadores = {};
        this.jugadores[jugador1.id] = jugador1;
        this.jugadores[jugador2.id] = jugador2; 
        this.cartasEnMesa = [];
        this.jugadoresQueJugaron = [];
        this.atributoActual = 0;
        this.esContraCPU = esContraCPU;
        this.juegoEnCurso = false;
    }

    iniciar() {
        Object.values(this.jugadores).forEach(j => {
            if (j.id !== 'cpu') {
                io.to(j.id).emit('initSeleccion', { 
                    id: j.id, 
                    todasLasCartas: todasLasCartas,
                    misDesbloqueos: j.idsDesbloqueados,
                    rivalNombre: this.obtenerRival(j.id).nombre
                });
            } else {
                this.cpuSeleccionarCartas();
            }
        });
    }

    obtenerRival(miId) {
        let ids = Object.keys(this.jugadores);
        let rivalId = ids.find(id => id !== miId);
        return this.jugadores[rivalId];
    }

    cpuSeleccionarCartas() {
        let disponibles = todasLasCartas.filter(c => !c.bloqueada);
        let manoCpu = [];
        for(let i=0; i<5; i++) {
            let r = Math.floor(Math.random() * disponibles.length);
            manoCpu.push(JSON.parse(JSON.stringify(disponibles[r])));
        }
        this.jugadores['cpu'].mano = manoCpu;
        this.jugadores['cpu'].manoInicial = JSON.parse(JSON.stringify(manoCpu));
        this.jugadores['cpu'].listo = true;
        this.verificarInicioJuego();
    }

    jugadorListo(id, indices) {
        let j = this.jugadores[id];
        let nuevaMano = [];
        indices.forEach(idx => nuevaMano.push(JSON.parse(JSON.stringify(todasLasCartas[idx]))));
        j.mano = nuevaMano;
        j.manoInicial = JSON.parse(JSON.stringify(nuevaMano));
        j.listo = true;
        this.verificarInicioJuego();
    }

    verificarInicioJuego() {
        let todosListos = Object.values(this.jugadores).every(j => j.listo);
        if (todosListos) {
            this.juegoEnCurso = true;
            this.emitirATodos('inicioJuego', {}); 
            Object.values(this.jugadores).forEach(j => {
                if(j.id !== 'cpu') io.to(j.id).emit('actualizarMano', j.mano);
            });
            this.comenzarSecuenciaTurno();
        } else {
            Object.values(this.jugadores).forEach(j => {
                if(j.id !== 'cpu' && j.listo) io.to(j.id).emit('esperandoRival');
            });
        }
    }

    comenzarSecuenciaTurno() {
        this.emitirATodos('girarDado');
        setTimeout(() => {
            this.cartasEnMesa = [];
            this.jugadoresQueJugaron = [];
            this.atributoActual = Math.floor(Math.random() * 8);
            this.emitirATodos('nuevoTurno', { atributo: nombresAtributos[this.atributoActual], indiceAtributo: this.atributoActual });
            if (this.esContraCPU) setTimeout(() => this.cpuJugarCarta(), 1500 + Math.random()*1000);
        }, 3000);
    }

    cpuJugarCarta() {
        if (!this.juegoEnCurso) return;
        let cpu = this.jugadores['cpu'];
        if (cpu.mano.length === 0) return;
        let indice = Math.floor(Math.random() * cpu.mano.length);
        this.procesarJugada('cpu', indice);
    }

    procesarJugada(idJugador, indiceCarta) {
        if (!this.juegoEnCurso) return;
        if (this.jugadoresQueJugaron.includes(idJugador)) return;
        let jugador = this.jugadores[idJugador];
        let carta = jugador.mano.splice(indiceCarta, 1)[0];
        this.jugadoresQueJugaron.push(idJugador);
        this.cartasEnMesa.push({ dueno: idJugador, carta: carta });
        if (idJugador !== 'cpu') io.to(idJugador).emit('cartaAceptada');
        this.emitirATodos('cartaJugadaAnuncio', idJugador);
        if (this.cartasEnMesa.length === 2) setTimeout(() => this.resolverBatalla(), 1000);
    }

    resolverBatalla() {
        let c1 = this.cartasEnMesa[0];
        let c2 = this.cartasEnMesa[1];
        let v1 = c1.carta.stats[this.atributoActual];
        let v2 = c2.carta.stats[this.atributoActual];
        let ganadorId = null;
        if (v1 > v2) ganadorId = c1.dueno; else if (v2 > v1) ganadorId = c2.dueno;

        if (ganadorId) {
            this.jugadores[ganadorId].mano.push(c1.carta);
            this.jugadores[ganadorId].mano.push(c2.carta);
        } else {
            this.jugadores[c1.dueno].mano.push(c1.carta);
            this.jugadores[c2.dueno].mano.push(c2.carta);
        }

        this.emitirATodos('resultado', { texto: ganadorId ? `¡Ganó ${this.jugadores[ganadorId].nombre}!` : "¡Empate!", ganador: ganadorId, cartas: this.cartasEnMesa });
        Object.values(this.jugadores).forEach(j => { if(j.id !== 'cpu') io.to(j.id).emit('actualizarMano', j.mano); });

        let perdedor = Object.values(this.jugadores).find(j => j.mano.length === 0);
        if (perdedor) {
            this.juegoEnCurso = false;
            let ganador = Object.values(this.jugadores).find(j => j.id !== perdedor.id);
            this.emitirATodos('juegoTerminado', { ganador: ganador.id });
        } else {
            setTimeout(() => this.comenzarSecuenciaTurno(), 4000);
        }
    }

    reiniciarMismoMazo(idJugador) {
        let j = this.jugadores[idJugador];
        j.mano = JSON.parse(JSON.stringify(j.manoInicial));
        j.listo = true;
        if(this.esContraCPU) {
            let cpu = this.jugadores['cpu'];
            cpu.mano = JSON.parse(JSON.stringify(cpu.manoInicial));
            cpu.listo = true;
        }
        if(idJugador !== 'cpu') io.to(idJugador).emit('esperandoRivalEndGame');
        this.verificarInicioJuego();
    }

    emitirATodos(evento, datos) {
        Object.values(this.jugadores).forEach(j => { if (j.id !== 'cpu') io.to(j.id).emit(evento, datos); });
    }
}

io.on('connection', (socket) => {
    console.log('Conectado: ' + socket.id);
    jugadoresConectados[socket.id] = { id: socket.id, nombre: "Anónimo", idPartida: null, idsDesbloqueados: [] };

    // 1. REGISTRO EN EL LOBBY
    socket.on('registrarUsuario', (nombre) => {
        jugadoresConectados[socket.id].nombre = nombre;
        socket.emit('registroExitoso');
    });

    // 2. MODOS DE JUEGO
    socket.on('buscarPartida', (modo) => {
        let jugador = jugadoresConectados[socket.id];
        
        if (modo === 'cpu') {
            let idPartida = 'pve_' + socket.id;
            let cpu = { id: 'cpu', nombre: 'Computadora', mano: [], idsDesbloqueados: [], listo: false };
            let partida = new Partida(idPartida, jugador, cpu, true);
            partidas[idPartida] = partida;
            jugador.idPartida = idPartida;
            partida.iniciar();

        } else if (modo === 'random') {
            if (colaEsperaPvP) {
                let rival = colaEsperaPvP;
                colaEsperaPvP = null; 
                crearPartidaPvP(rival, jugador);
            } else {
                colaEsperaPvP = jugador;
                socket.emit('mensajeEspera', 'Buscando usuario libre...');
            }
        }
    });

    // 3. RETAR A ALGUIEN ESPECÍFICO
    socket.on('retarJugador', (nombreRival) => {
        let retador = jugadoresConectados[socket.id];
        // Buscar rival por nombre (case insensitive)
        let rivalSocketId = Object.keys(jugadoresConectados).find(id => 
            jugadoresConectados[id].nombre.toLowerCase() === nombreRival.toLowerCase() && id !== socket.id
        );

        if (rivalSocketId) {
            let rival = jugadoresConectados[rivalSocketId];
            if (rival.idPartida) {
                socket.emit('errorReto', `El usuario ${nombreRival} ya está jugando.`);
            } else {
                // Enviar invitación
                io.to(rivalSocketId).emit('solicitudReto', { 
                    idRetador: socket.id, 
                    nombreRetador: retador.nombre 
                });
                socket.emit('mensajeEspera', `Invitación enviada a ${rival.nombre}...`);
            }
        } else {
            socket.emit('errorReto', `No se encontró al usuario "${nombreRival}". Asegúrate que esté en el Lobby.`);
        }
    });

    socket.on('respuestaReto', (data) => {
        let yo = jugadoresConectados[socket.id];
        let retador = jugadoresConectados[data.idRetador];
        
        if (!retador) return; // Se desconectó mientras respondías

        if (data.acepta) {
            // Crear partida
            crearPartidaPvP(retador, yo);
        } else {
            io.to(data.idRetador).emit('errorReto', `${yo.nombre} rechazó tu desafío.`);
        }
    });

    function crearPartidaPvP(jugadorA, jugadorB) {
        let idPartida = 'pvp_' + jugadorA.id + '_' + jugadorB.id;
        let partida = new Partida(idPartida, jugadorA, jugadorB, false);
        partidas[idPartida] = partida;
        jugadorA.idPartida = idPartida;
        jugadorB.idPartida = idPartida;
        partida.iniciar();
    }

    // --- JUEGO ---
    socket.on('intentarDesbloquear', (data) => {
        let carta = todasLasCartas.find(c => c.id === data.idCarta);
        if (carta && carta.codigo === data.codigo.toUpperCase()) {
            jugadoresConectados[socket.id].idsDesbloqueados.push(data.idCarta);
            socket.emit('desbloqueoExitoso', { id: data.idCarta, nombre: carta.nombre });
        } else { socket.emit('errorDesbloqueo', "Código incorrecto"); }
    });

    socket.on('jugadorListo', (indices) => {
        let j = jugadoresConectados[socket.id];
        if (j.idPartida && partidas[j.idPartida]) partidas[j.idPartida].jugadorListo(socket.id, indices);
    });

    socket.on('jugarCarta', (index) => {
        let j = jugadoresConectados[socket.id];
        if (j.idPartida && partidas[j.idPartida]) partidas[j.idPartida].procesarJugada(socket.id, index);
    });

    socket.on('decisionFinPartida', (accion) => {
        let j = jugadoresConectados[socket.id];
        let p = partidas[j.idPartida];
        if (!p) return;

        if (accion === 'mismo') p.reiniciarMismoMazo(socket.id);
        else if (accion === 'cambiar') {
            p.jugadores[socket.id].listo = false;
            p.jugadores[socket.id].mano = [];
            if (p.esContraCPU) p.cpuSeleccionarCartas();
            socket.emit('initSeleccion', { id: socket.id, todasLasCartas: todasLasCartas, misDesbloqueos: j.idsDesbloqueados, rivalNombre: p.obtenerRival(socket.id).nombre });
        } else if (accion === 'salir') {
            let rival = p.obtenerRival(socket.id);
            if (rival && rival.id !== 'cpu') {
                io.to(rival.id).emit('rivalAbandono');
                let rivalSocket = jugadoresConectados[rival.id];
                if(rivalSocket) rivalSocket.idPartida = null;
            }
            delete partidas[p.id];
            j.idPartida = null;
        }
    });

    socket.on('disconnect', () => {
        let j = jugadoresConectados[socket.id];
        if (colaEsperaPvP && colaEsperaPvP.id === socket.id) colaEsperaPvP = null;
        if (j && j.idPartida && partidas[j.idPartida]) {
            let p = partidas[j.idPartida];
            p.emitirATodos('resetTotal'); 
            delete partidas[j.idPartida];
        }
        delete jugadoresConectados[socket.id];
    });
});

http.listen(3000, () => { console.log('Servidor 3000 listo'); });
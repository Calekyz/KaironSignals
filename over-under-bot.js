const WebSocket = require('ws');
const axios = require('axios');

class OverUnderBot {
    constructor() {
        this.ws = null;
        this.isConnected = false;
        this.priceData = [];
        this.digitsHistory = [];
        this.digitPercentages = Array(10).fill(0);
        this.gbDigit = null;      // Green Bar (most appearing)
        this.secondMostDigit = null;
        this.rbDigit = null;       // Red Bar (least appearing)
        this.secondLeastDigit = null;
        this.maxHistory = parseInt(process.env.TICKS_ANALYSIS_COUNT) || 60;
        this.currentMarket = process.env.DERIV_MARKET || 'R_100';
        this.derivAppId = process.env.DERIV_APP_ID || '3301jaeZWyGCapwrS0scH';
        this.losingDigitMin = parseFloat(process.env.LOSING_DIGIT_MIN_PERCENT) || 9.7;
        this.losingDigitMax = parseFloat(process.env.LOSING_DIGIT_MAX_PERCENT) || 10.4;
        this.wsUrl = `wss://ws.binaryws.com/websockets/v3?app_id=${this.derivAppId}`;
        this.requestId = 1;
        this.pendingRequests = new Map();
    }

    async connect() {
        return new Promise((resolve, reject) => {
            console.log('🔌 Connecting to Deriv WebSocket...');
            this.ws = new WebSocket(this.wsUrl);
            
            this.ws.on('open', async () => {
                console.log('✅ Connected to Deriv');
                this.isConnected = true;
                await this.subscribeToTicks();
                await this.fetchHistoricalData();
                resolve();
            });
            
            this.ws.on('message', (data) => {
                const response = JSON.parse(data);
                this.handleResponse(response);
            });
            
            this.ws.on('error', (error) => {
                console.error('❌ WebSocket error:', error.message);
                reject(error);
            });
            
            this.ws.on('close', () => {
                console.log('⚠️ Disconnected, reconnecting...');
                this.isConnected = false;
                setTimeout(() => this.connect(), 5000);
            });
        });
    }

    sendRequest(msgType, params = {}) {
        return new Promise((resolve, reject) => {
            if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
                reject(new Error('WebSocket not connected'));
                return;
            }
            const reqId = this.requestId++;
            const request = { [msgType]: 1, req_id: reqId, ...params };
            this.pendingRequests.set(reqId, { resolve, reject });
            setTimeout(() => {
                if (this.pendingRequests.has(reqId)) {
                    this.pendingRequests.delete(reqId);
                    reject(new Error('Request timeout'));
                }
            }, 10000);
            this.ws.send(JSON.stringify(request));
        });
    }

    async subscribeToTicks() {
        try {
            await this.sendRequest('ticks', { ticks: this.currentMarket, subscribe: 1 });
            console.log(`📈 Subscribed to ${this.currentMarket}`);
        } catch (error) {
            console.error('Subscription failed:', error.message);
        }
    }

    async fetchHistoricalData() {
        try {
            const response = await this.sendRequest('ticks_history', {
                ticks_history: this.currentMarket,
                adjust_start_time: 1,
                count: this.maxHistory,
                end: 'latest',
                style: 'ticks'
            });
            
            if (response && response.history && response.history.prices) {
                const prices = response.history.prices.map(p => parseFloat(p));
                this.priceData = prices;
                this.extractDigits();
                this.calculateDigitPercentages();
                this.identifyKeyDigits();
                console.log(`📊 Loaded ${this.priceData.length} ticks (${this.maxHistory} ticks analysis)`);
            }
        } catch (error) {
            console.error('Failed to fetch historical data:', error.message);
            this.startSimulation();
        }
    }

    getLastDigit(price) {
        const priceStr = price.toString();
        const decimalMatch = priceStr.match(/\.(\d)/);
        if (decimalMatch) {
            return parseInt(decimalMatch[1]);
        }
        return Math.floor(price) % 10;
    }

    extractDigits() {
        this.digitsHistory = [];
        this.priceData.forEach(price => {
            const digit = this.getLastDigit(price);
            this.digitsHistory.push(digit);
        });
    }

    calculateDigitPercentages() {
        const counts = Array(10).fill(0);
        this.digitsHistory.forEach(d => {
            if (d >= 0 && d <= 9) counts[d]++;
        });
        
        const total = this.digitsHistory.length;
        this.digitPercentages = counts.map(count => (count / total) * 100);
        
        console.log('📊 Digit Percentages (60 ticks):');
        this.digitPercentages.forEach((pct, i) => {
            console.log(`   Digit ${i}: ${pct.toFixed(2)}%`);
        });
    }

    identifyKeyDigits() {
        // Find most appearing digit (Green Bar / GB)
        let maxCount = -1;
        let minCount = Infinity;
        
        for (let i = 0; i <= 9; i++) {
            const count = this.digitsHistory.filter(d => d === i).length;
            if (count > maxCount) {
                maxCount = count;
                this.gbDigit = i;
            }
            if (count < minCount) {
                minCount = count;
                this.rbDigit = i;
            }
        }
        
        // Find second most appearing digit
        const digitCounts = Array(10).fill(0);
        this.digitsHistory.forEach(d => digitCounts[d]++);
        
        const sorted = [...Array(10).keys()].sort((a, b) => digitCounts[b] - digitCounts[a]);
        this.secondMostDigit = sorted[1];
        
        // Find second least appearing digit
        this.secondLeastDigit = sorted[sorted.length - 2];
        
        console.log(`🎯 Key Digits Identified:`);
        console.log(`   GB (Most): ${this.gbDigit} (${this.digitPercentages[this.gbDigit].toFixed(2)}%)`);
        console.log(`   2nd Most: ${this.secondMostDigit} (${this.digitPercentages[this.secondMostDigit].toFixed(2)}%)`);
        console.log(`   RB (Least): ${this.rbDigit} (${this.digitPercentages[this.rbDigit].toFixed(2)}%)`);
        console.log(`   2nd Least: ${this.secondLeastDigit} (${this.digitPercentages[this.secondLeastDigit].toFixed(2)}%)`);
    }

    checkLosingDigitsCondition() {
        // Check if losing digits are within 9.7% - 10.4%
        for (let i = 0; i <= 9; i++) {
            const pct = this.digitPercentages[i];
            if (pct >= this.losingDigitMin && pct <= this.losingDigitMax) {
                console.log(`✅ Losing digit ${i} at ${pct.toFixed(2)}% - within range`);
                return true;
            }
        }
        return false;
    }

    applyOverUnderStrategy(analysis, sessionStats) {
        // Strategy 1: Using GB, 2nd Most, RB
        const { gbDigit, secondMostDigit, rbDigit, secondLeastDigit, digitPercentages } = analysis;
        
        let signal = null;
        let strategy = null;
        
        // Check if we need recovery mode
        if (sessionStats.recoveryMode) {
            return this.getRecoverySignal(analysis);
        }
        
        // STRATEGY 1: GB + 2nd Most + RB condition
        const digitsForStrategy1 = [gbDigit, secondMostDigit, rbDigit];
        const allBetween0and6 = digitsForStrategy1.every(d => d >= 0 && d <= 6);
        const allBetween3and9 = digitsForStrategy1.every(d => d >= 3 && d <= 9);
        
        if (allBetween0and6) {
            // Trade UNDER 7
            signal = 'UNDER 7';
            strategy = 1;
            console.log(`📐 Strategy 1 Trigger: All digits (${digitsForStrategy1.join(',')}) are between 0-6 → UNDER 7`);
        } else if (allBetween3and9) {
            // Trade OVER 2
            signal = 'OVER 2';
            strategy = 1;
            console.log(`📐 Strategy 1 Trigger: All digits (${digitsForStrategy1.join(',')}) are between 3-9 → OVER 2`);
        } else {
            // Try Strategy 2
            console.log(`📐 Strategy 1 not triggered, trying Strategy 2...`);
            
            // STRATEGY 2: Using second least digit for OVER 5 / UNDER 4
            if (secondLeastDigit >= 5 && secondLeastDigit <= 9) {
                signal = 'OVER 5';
                strategy = 2;
                console.log(`📐 Strategy 2: Second least digit ${secondLeastDigit} → OVER 5`);
            } else if (secondLeastDigit >= 0 && secondLeastDigit <= 4) {
                signal = 'UNDER 4';
                strategy = 2;
                console.log(`📐 Strategy 2: Second least digit ${secondLeastDigit} → UNDER 4`);
            }
        }
        
        if (!signal) {
            return { action: 'WAIT', reason: 'No strategy conditions met' };
        }
        
        // Determine entry digit based on signal
        let entryDigit = null;
        if (signal === 'UNDER 7' || signal === 'UNDER 4') {
            entryDigit = 6;  // For UNDER markets, use digit 6
        } else if (signal === 'OVER 2' || signal === 'OVER 5') {
            entryDigit = 5;  // For OVER markets, use digit 5 or 3 (prefer 5)
        }
        
        // Calculate confidence
        let confidence = this.calculateConfidence(analysis, signal);
        
        // Check losing digits condition for better accuracy
        const losingDigitsOk = this.checkLosingDigitsCondition();
        if (!losingDigitsOk) {
            confidence -= 15;
            console.log(`⚠️ Losing digits not in optimal range (${this.losingDigitMin}-${this.losingDigitMax}%)`);
        }
        
        // GB power check
        const gbPercent = digitPercentages[gbDigit];
        if (gbPercent < 12) {
            confidence -= 10;
            console.log(`⚠️ GB power low: ${gbPercent.toFixed(2)}% (below 12%)`);
        }
        
        confidence = Math.max(30, Math.min(95, confidence));
        
        return {
            action: 'TRADE',
            type: signal,
            strategy: strategy,
            entryDigit: entryDigit,
            confidence: Math.round(confidence),
            gbDigit: gbDigit,
            gbPercent: digitPercentages[gbDigit].toFixed(2),
            secondMostDigit: secondMostDigit,
            secondMostPercent: digitPercentages[secondMostDigit].toFixed(2),
            rbDigit: rbDigit,
            rbPercent: digitPercentages[rbDigit].toFixed(2),
            secondLeastDigit: secondLeastDigit,
            secondLeastPercent: digitPercentages[secondLeastDigit].toFixed(2),
            timestamp: new Date().toISOString()
        };
    }

    getRecoverySignal(analysis) {
        // Recovery method: switch from over 1 to over 3 for recovery
        const { gbDigit, digitPercentages } = analysis;
        
        console.log(`🔄 Recovery mode active - switching strategy`);
        
        if (gbDigit >= 5) {
            return {
                action: 'TRADE',
                type: 'OVER 3 (RECOVERY)',
                strategy: 'recovery',
                entryDigit: 7,
                confidence: 70,
                recoveryNote: 'Switch from over 1 to over 3 for recovery',
                ...analysis,
                timestamp: new Date().toISOString()
            };
        } else {
            return {
                action: 'TRADE',
                type: 'UNDER 1 (RECOVERY)',
                strategy: 'recovery',
                entryDigit: 2,
                confidence: 65,
                recoveryNote: 'Recovery entry',
                ...analysis,
                timestamp: new Date().toISOString()
            };
        }
    }

    calculateConfidence(analysis, signal) {
        const { digitPercentages, gbDigit, secondMostDigit, rbDigit } = analysis;
        
        let confidence = 50;
        
        // GB power contribution
        const gbPercent = digitPercentages[gbDigit];
        if (gbPercent > 15) confidence += 15;
        else if (gbPercent > 12) confidence += 10;
        else if (gbPercent > 10) confidence += 5;
        
        // 2nd most power contribution
        const secondPercent = digitPercentages[secondMostDigit];
        if (secondPercent > 12) confidence += 10;
        else if (secondPercent > 10) confidence += 5;
        
        // RB power contribution (low is good)
        const rbPercent = digitPercentages[rbDigit];
        if (rbPercent < 8) confidence += 10;
        else if (rbPercent < 10) confidence += 5;
        
        // Signal type bonus
        if (signal === 'OVER 2' || signal === 'UNDER 7') confidence += 10;
        else if (signal === 'OVER 5' || signal === 'UNDER 4') confidence += 5;
        
        return Math.min(95, confidence);
    }

    formatSignalMessage(signal, analysis, sessionStats) {
        const signalEmoji = signal.type.includes('OVER') ? '📈' : '📉';
        const strategyEmoji = signal.strategy === 1 ? '🎯' : '⚡';
        
        let message = `🔔 **NEW TRADING SIGNAL** 🔔\n\n`;
        message += `${signalEmoji} **${signal.type}**\n`;
        message += `${strategyEmoji} Strategy: ${signal.strategy === 1 ? 'GB + 2nd Most + RB' : 'Second Least Digit'}\n\n`;
        
        message += `📊 **Market Analysis (${analysis.maxHistory} ticks):**\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `🟢 GB (Most): Digit **${signal.gbDigit}** (${signal.gbPercent}%)\n`;
        message += `🔵 2nd Most: Digit **${signal.secondMostDigit}** (${signal.secondMostPercent}%)\n`;
        message += `🔴 RB (Least): Digit **${signal.rbDigit}** (${signal.rbPercent}%)\n`;
        message += `🟡 2nd Least: Digit **${signal.secondLeastDigit}** (${signal.secondLeastPercent}%)\n\n`;
        
        message += `🎯 **Entry Instructions:**\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `💹 Trade: **${signal.type}**\n`;
        message += `🔑 Entry Digit: **${signal.entryDigit}**\n`;
        message += `⭐ Confidence: **${signal.confidence}%**\n\n`;
        
        if (signal.strategy === 'recovery') {
            message += `🔄 **RECOVERY MODE**\n`;
            message += `${signal.recoveryNote}\n\n`;
        }
        
        message += `📈 **Session Stats:**\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `✅ Total Signals: ${sessionStats.totalSignals}\n`;
        message += `🏆 Consecutive Wins: ${sessionStats.consecutiveWins}\n`;
        message += `🔄 Runs This Session: ${sessionStats.totalRuns}\n\n`;
        
        message += `⚠️ **Risk Management:**\n`;
        message += `━━━━━━━━━━━━━━━━━━━━━\n`;
        message += `• Stop after 4 consecutive wins\n`;
        message += `• Max 5 runs per session\n`;
        message += `• Use proper recovery if loss occurs\n\n`;
        
        message += `⏰ Time: ${new Date().toLocaleString()}\n`;
        message += `🤖 Generated by KAIRON Over/Under Bot\n`;
        message += `#TradingSignal #Deriv #OverUnder`;
        
        return message;
    }

    formatStopMessage(sessionStats) {
        const winRate = sessionStats.totalSignals > 0 
            ? ((sessionStats.wins / sessionStats.totalSignals) * 100).toFixed(1) 
            : 0;
        
        return `🔴 **SESSION PAUSED** 🔴\n\n` +
               `Reached ${sessionStats.consecutiveWins} consecutive wins!\n` +
               `Find new entry before continuing.\n\n` +
               `📊 **Session Summary:**\n` +
               `━━━━━━━━━━━━━━━━━━━━━\n` +
               `✅ Wins: ${sessionStats.wins}\n` +
               `❌ Losses: ${sessionStats.losses}\n` +
               `📈 Win Rate: ${winRate}%\n` +
               `🔄 Total Runs: ${sessionStats.totalRuns}\n\n` +
               `⏸️ Bot paused for 30 minutes cooldown...\n` +
               `🔄 Resume at: ${new Date(Date.now() + 30 * 60 * 1000).toLocaleTimeString()}`;
    }

    formatResumeMessage() {
        return `🟢 **SESSION RESUMED** 🟢\n\n` +
               `Cooldown period complete.\n` +
               `Ready for new trading signals!\n\n` +
               `⏰ Time: ${new Date().toLocaleString()}`;
    }

    async fetchDigitsAnalysis() {
        // Try to connect to Deriv if not connected
        if (!this.isConnected) {
            await this.connect();
        }
        
        // Refresh data
        await this.fetchHistoricalData();
        
        return {
            gbDigit: this.gbDigit,
            secondMostDigit: this.secondMostDigit,
            rbDigit: this.rbDigit,
            secondLeastDigit: this.secondLeastDigit,
            digitPercentages: this.digitPercentages,
            digitsHistory: this.digitsHistory,
            maxHistory: this.maxHistory,
            timestamp: new Date().toISOString()
        };
    }

    startSimulation() {
        console.log('⚠️ Starting simulation mode with synthetic data');
        
        // Generate synthetic digit data for testing
        const simulateDigits = () => {
            const syntheticDigits = [];
            for (let i = 0; i < this.maxHistory; i++) {
                syntheticDigits.push(Math.floor(Math.random() * 10));
            }
            this.digitsHistory = syntheticDigits;
            this.calculateDigitPercentages();
            this.identifyKeyDigits();
        };
        
        simulateDigits();
        setInterval(() => simulateDigits(), 60000);
    }
}

module.exports = OverUnderBot;

require('dotenv').config();
const cron = require('node-cron');
const axios = require('axios');
const OverUnderBot = require('./over-under-bot');
const TelegramNotifier = require('./telegram-notifier');

console.log('🎯 KAIRON Over/Under Strategy Bot Starting...');
console.log('=============================================');
console.log(`📊 Strategy 1: GB + 2nd Most + RB → UNDER 7 (0-6) or OVER 2 (3-9)`);
console.log(`📊 Strategy 2: UNDER use digit 6 | OVER use digit 5 or 3`);
console.log(`⏰ Analysis interval: ${process.env.ANALYSIS_INTERVAL_MINUTES || 30} minutes`);
console.log(`📨 Will send signals to Telegram channel`);
console.log(`🎯 Max consecutive wins before stop: ${process.env.MAX_CONSECUTIVE_WINS || 4}`);
console.log(`📈 Losing digits range: ${process.env.LOSING_DIGIT_MIN_PERCENT || 9.7}% - ${process.env.LOSING_DIGIT_MAX_PERCENT || 10.4}%`);

const bot = new OverUnderBot();
const notifier = new TelegramNotifier();

// Track session stats
let sessionStats = {
    totalSignals: 0,
    wins: 0,
    losses: 0,
    consecutiveWins: 0,
    totalRuns: 0,
    isActive: true,
    recoveryMode: false,
    lastSignal: null
};

async function analyzeAndSendSignal() {
    try {
        console.log(`\n🔍 [${new Date().toLocaleString()}] Running Over/Under analysis...`);
        
        // Fetch digits analysis from Deriv/calekyz.com
        const analysis = await bot.fetchDigitsAnalysis();
        
        if (analysis.error) {
            console.log(`⚠️ Analysis error: ${analysis.error}`);
            return;
        }
        
        // Apply Over/Under strategies
        const signal = bot.applyOverUnderStrategy(analysis, sessionStats);
        
        if (signal && signal.action !== 'WAIT') {
            // Check consecutive wins limit
            if (sessionStats.consecutiveWins >= (process.env.MAX_CONSECUTIVE_WINS || 4)) {
                console.log(`🛑 Stopped - reached ${sessionStats.consecutiveWins} consecutive wins`);
                const stopMessage = bot.formatStopMessage(sessionStats);
                await notifier.sendToTelegram(stopMessage);
                
                // Reset session after 30 min cooldown
                sessionStats.isActive = false;
                setTimeout(() => {
                    sessionStats.isActive = true;
                    sessionStats.consecutiveWins = 0;
                    sessionStats.totalRuns = 0;
                    sessionStats.recoveryMode = false;
                    notifier.sendToTelegram(bot.formatResumeMessage());
                }, 30 * 60 * 1000);
                return;
            }
            
            // Send signal to Telegram
            const message = bot.formatSignalMessage(signal, analysis, sessionStats);
            await notifier.sendToTelegram(message);
            
            // Update session stats
            sessionStats.totalSignals++;
            sessionStats.lastSignal = signal;
            
            console.log(`✅ Signal sent: ${signal.type} ${signal.entry} (Confidence: ${signal.confidence}%)`);
            console.log(`   Strategy: ${signal.strategy}`);
            console.log(`   Entry digit: ${signal.entryDigit}`);
        } else if (signal && signal.action === 'WAIT') {
            console.log(`⏳ ${signal.reason}`);
        } else {
            console.log(`❌ No valid signal generated`);
        }
        
    } catch (error) {
        console.error(`❌ Analysis failed:`, error.message);
    }
}

// Run analysis every 30 minutes (or configured interval)
const intervalMinutes = parseInt(process.env.ANALYSIS_INTERVAL_MINUTES) || 30;
cron.schedule(`*/${intervalMinutes} * * * *`, () => {
    if (sessionStats.isActive) {
        analyzeAndSendSignal();
    } else {
        console.log(`⏸️ Bot paused - waiting for cooldown period...`);
    }
});

// Run immediately on start
setTimeout(() => {
    if (sessionStats.isActive) {
        analyzeAndSendSignal();
    }
}, 5000);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Shutting down Over/Under bot...');
    process.exit(0);
});

console.log(`\n✅ Bot is running! Next analysis in ${intervalMinutes} minutes...`);

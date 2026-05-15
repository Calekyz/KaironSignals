const { Telegraf } = require('telegraf');

class TelegramNotifier {
    constructor() {
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.channelId = process.env.TELEGRAM_CHANNEL_ID;
        
        if (!this.botToken || !this.channelId) {
            console.error('❌ Missing Telegram credentials in .env file');
            console.log('Please set TELEGRAM_BOT_TOKEN and TELEGRAM_CHANNEL_ID');
        }
        
        this.bot = new Telegraf(this.botToken);
    }

    async sendToTelegram(message) {
        if (!this.botToken || !this.channelId) {
            console.log('📝 Message (Telegram not configured):');
            console.log(message);
            return;
        }

        try {
            await this.bot.telegram.sendMessage(this.channelId, message, {
                parse_mode: 'Markdown',
                disable_web_page_preview: false
            });
            console.log('✅ Message sent to Telegram channel');
        } catch (error) {
            console.error('❌ Failed to send to Telegram:', error.message);
            
            // Try sending without Markdown if that was the issue
            if (error.message.includes('parse')) {
                try {
                    await this.bot.telegram.sendMessage(this.channelId, message, {
                        disable_web_page_preview: false
                    });
                    console.log('✅ Message sent (without Markdown)');
                } catch (retryError) {
                    console.error('❌ Retry failed:', retryError.message);
                }
            }
        }
    }

    async sendSignal(signal) {
        // Format the signal for Telegram
        let message = this.formatSignalForTelegram(signal);
        await this.sendToTelegram(message);
    }

    formatSignalForTelegram(signal) {
        const emoji = signal.type.includes('OVER') ? '📈' : '📉';
        
        return `${emoji} *${signal.type} SIGNAL* ${emoji}\n\n` +
               `Entry: *${signal.entryDigit}*\n` +
               `Confidence: *${signal.confidence}%*\n` +
               `Strategy: ${signal.strategy === 1 ? 'GB + 2nd Most + RB' : 'Second Least Digit'}\n\n` +
               `GB: ${signal.gbDigit} (${signal.gbPercent}%)\n` +
               `2nd Most: ${signal.secondMostDigit} (${signal.secondMostPercent}%)\n` +
               `RB: ${signal.rbDigit} (${signal.rbPercent}%)\n\n` +
               `Time: ${new Date(signal.timestamp).toLocaleString()}`;
    }
}

module.exports = TelegramNotifier;

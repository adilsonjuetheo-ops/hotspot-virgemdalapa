const axios = require('axios');

async function sendOTP(phone, code) {
  const token = process.env.ZENVIA_TOKEN;
  const from = process.env.ZENVIA_FROM || 'VirgemLapa';

  // Formata o número para E.164 (Brasil)
  const formattedPhone = formatPhone(phone);
  const message = `Prefeitura de Virgem da Lapa: Seu codigo de acesso e ${code}. Valido por ${process.env.OTP_EXPIRY_MINUTES || 5} minutos.`;

  try {
    const response = await axios.post(
      'https://api.zenvia.com/v2/channels/sms/messages',
      {
        from,
        to: formattedPhone,
        contents: [{ type: 'text', text: message }]
      },
      {
        headers: {
          'X-API-TOKEN': token,
          'Content-Type': 'application/json'
        }
      }
    );
    return { success: true, messageId: response.data.id };
  } catch (error) {
    console.error('Erro ao enviar SMS Zenvia:', error.response?.data || error.message);
    throw new Error('Falha ao enviar SMS. Verifique a configuração da Zenvia.');
  }
}

function formatPhone(phone) {
  // Remove tudo que não é dígito
  const digits = phone.replace(/\D/g, '');
  // Garante código do Brasil
  if (digits.startsWith('55') && digits.length >= 12) return `+${digits}`;
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
  return `+55${digits}`;
}

function generateOTP() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

module.exports = { sendOTP, generateOTP, formatPhone };

export type PhoneOtpMode = 'console' | 'twilio' | 'disabled';

export interface TwilioOtpConfig {
  accountSid: string;
  authToken: string;
  fromNumber: string;
}

export function createPhoneOtpDelivery(mode: PhoneOtpMode, twilioConfig?: TwilioOtpConfig) {
  return async (phone: string, code: string) => {
    if (mode === 'disabled') {
      throw new Error('Phone OTP delivery provider is not configured');
    }

    const suffix = phone.replace(/\D/g, '').slice(-2) || 'unknown';

    if (mode === 'twilio') {
      if (!twilioConfig) {
        throw new Error('Twilio configuration is missing');
      }
      const { default: Twilio } = await import('twilio');
      const client = Twilio(twilioConfig.accountSid, twilioConfig.authToken);
      const message = await client.messages.create({
        body: `Tenka: tu código de verificación es ${code}. No lo compartas con nadie.`,
        to: phone,
        from: twilioConfig.fromNumber,
      });
      console.info(`[phone-number] OTP sent via Twilio to phone ending ${suffix} (sid ${message.sid})`);
      return;
    }

    console.info(`[phone-number] OTP for phone ending ${suffix}: ${code}`);
  };
}

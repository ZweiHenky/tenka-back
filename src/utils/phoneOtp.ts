export function createPhoneOtpDelivery(mode: 'console' | 'disabled') {
  return async (phone: string, code: string) => {
    if (mode === 'disabled') {
      throw new Error('Phone OTP delivery provider is not configured');
    }

    const suffix = phone.replace(/\D/g, '').slice(-2);
    console.info(`[phone-number] OTP for phone ending ${suffix || 'unknown'}: ${code}`);
  };
}

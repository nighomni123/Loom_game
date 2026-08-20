// Vercel Web Analytics initialization
import { inject } from '@vercel/analytics';

// Initialize analytics tracking
inject({
  mode: 'auto', // Automatically detects development vs production
  debug: true   // Enable debug logging in development
});

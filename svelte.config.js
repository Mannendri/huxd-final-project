import vercel from '@sveltejs/adapter-vercel';

// SvelteKit configuration for MentorAI
const config = {
  kit: {
    adapter: vercel({ runtime: 'nodejs20.x' })
  }
};

export default config;

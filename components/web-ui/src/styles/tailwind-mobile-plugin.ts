import plugin from 'tailwindcss/plugin';

export default plugin(
  ({ addBase }) => {
    addBase({
      ':root': {
        '--text-mobile-h1': '1.5rem',
        '--text-mobile-h2': '1.25rem',
        '--text-mobile-h3': '1.0625rem',
        '--text-mobile-body': '1rem',
        '--text-mobile-caption': '0.8125rem',
        '--leading-mobile-tight': '1.2',
        '--leading-mobile-normal': '1.35',
        '--tracking-mobile-tight': '-0.01em',
        '--tracking-mobile-normal': '0',
      },
    });
  },
  {
    theme: {
      text: {
        'mobile-h1': 'var(--text-mobile-h1)',
        'mobile-h2': 'var(--text-mobile-h2)',
        'mobile-h3': 'var(--text-mobile-h3)',
        'mobile-body': 'var(--text-mobile-body)',
        'mobile-caption': 'var(--text-mobile-caption)',
      },
      leading: {
        'mobile-tight': 'var(--leading-mobile-tight)',
        'mobile-normal': 'var(--leading-mobile-normal)',
      },
      tracking: {
        'mobile-tight': 'var(--tracking-mobile-tight)',
        'mobile-normal': 'var(--tracking-mobile-normal)',
      },
    },
  },
);

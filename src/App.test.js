import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';
import { Context } from './context/AuthContext';

const authContextValue = {
  accountType: null,
  recentlySelectedCompany: null,
  recentlySelectedCompanyName: '',
  user: null,
};

beforeEach(() => {
  window.localStorage.clear();
  window.matchMedia = jest.fn().mockImplementation((query) => ({
    addEventListener: jest.fn(),
    addListener: jest.fn(),
    dispatchEvent: jest.fn(),
    matches: query === '(prefers-color-scheme: dark)',
    media: query,
    onchange: null,
    removeEventListener: jest.fn(),
    removeListener: jest.fn(),
  }));
});

const renderApp = () => render(
  <MemoryRouter initialEntries={['/not-found-test-route']}>
    <Context.Provider value={authContextValue}>
      <App />
    </Context.Provider>
  </MemoryRouter>
);

test('renders the app shell in light mode by default', () => {
  const { container } = renderApp();

  expect(container.querySelector('.app-theme-root.theme-light')).toBeInTheDocument();
  expect(document.documentElement).toHaveClass('theme-light');
  expect(window.localStorage.getItem('dripDropThemePreference')).toBe('light');
});

test('migrates the old system preference to light mode', () => {
  window.localStorage.setItem('dripDropThemePreference', 'system');

  const { container } = renderApp();

  expect(container.querySelector('.app-theme-root.theme-light')).toBeInTheDocument();
  expect(document.documentElement).toHaveClass('theme-light');
  expect(window.localStorage.getItem('dripDropThemePreference')).toBe('light');
});

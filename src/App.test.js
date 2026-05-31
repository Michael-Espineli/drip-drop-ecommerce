import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from './App';

test('renders the app shell inside a router', () => {
  const { container } = render(
    <MemoryRouter initialEntries={['/not-found-test-route']}>
      <App />
    </MemoryRouter>
  );

  expect(container.querySelector('.dark-theme')).toBeInTheDocument();
});

import '@fontsource-variable/inter';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import { configureAuth } from './lib/auth';
import { loadConfig } from './lib/config';

const root = createRoot(document.getElementById('root')!);
loadConfig()
  .then((config) => {
    configureAuth(config);
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error: Error) => root.render(<p className="fatal">{error.message}</p>));

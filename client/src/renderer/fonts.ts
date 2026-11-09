import '@fontsource-variable/inter';
import '@fontsource-variable/montserrat';
import '@fontsource-variable/oswald';
import '@fontsource-variable/playfair-display';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';
import { FONT_NAMES, FONTS } from '../../../shared/src/index';

let loading: Promise<void> | undefined;

export function ensureFonts(): Promise<void> {
  loading ??= Promise.all(
    FONT_NAMES.flatMap((name) =>
      FONTS[name].weights.map((weight) =>
        document.fonts.load(`${weight} 32px "${FONTS[name].css}"`),
      ),
    ),
  ).then(() => undefined);
  return loading;
}

import './style.css';
import { toast } from './ui.js';
const mobile = location.pathname.startsWith('/capture');
(mobile ? import('./mobile.js') : import('./editor.js')).then(module => module.start()).catch(error => { console.error(error); toast(`Unable to start RoomShift: ${error.message}`, true); });

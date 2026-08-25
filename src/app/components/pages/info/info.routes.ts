import { Routes } from '@angular/router';
import { provideMarkdown } from 'ngx-markdown';

import { Info } from './info';

/**
 * Kept apart from the app's routes so the markdown renderer is fetched with this
 * screen. Naming it in the eager route table would pull it into the first load.
 */
export const routes: Routes = [
	{
		path: '',
		providers: [provideMarkdown()],
		component: Info,
	},
];

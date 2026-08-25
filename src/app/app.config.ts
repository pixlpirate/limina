import {
	ApplicationConfig,
	inject,
	isDevMode,
	provideAppInitializer,
	provideBrowserGlobalErrorListeners,
} from '@angular/core';
import { provideHttpClient, withFetch } from '@angular/common/http';
import { provideRouter, TitleStrategy } from '@angular/router';
import { provideServiceWorker } from '@angular/service-worker';
import { provideTranslateService } from '@ngx-translate/core';
import { provideTranslateHttpLoader } from '@ngx-translate/http-loader';

import { provideMaplibreWorker } from '@maplibre/ngx-maplibre-gl/config';

import { AppTitleStrategy } from './app-title.strategy';
import { routes } from './app.routes';
import { AppUpdateService, LanguageService } from '@services';

export const appConfig: ApplicationConfig = {
	providers: [
		provideBrowserGlobalErrorListeners(),
		provideHttpClient(withFetch()),
		provideRouter(routes),
		{ provide: TitleStrategy, useClass: AppTitleStrategy },
		provideTranslateService({
			fallbackLang: 'en',
		}),
		provideTranslateHttpLoader({ prefix: 'i18n/', suffix: '.json' }),
		provideAppInitializer(() => inject(LanguageService).load()),
		provideServiceWorker('ngsw-worker.js', {
			enabled: !isDevMode(),
			registrationStrategy: 'registerWhenStable:30000',
		}),
		provideAppInitializer(() => inject(AppUpdateService).watch()),
		provideMaplibreWorker('maplibre-gl-worker.mjs'),
	],
};

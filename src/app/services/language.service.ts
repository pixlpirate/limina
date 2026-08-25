import { effect, inject, Injectable } from '@angular/core';
import { Language, LANGUAGE_FLAGS, LANGUAGE_NAMES, LANGUAGES } from '@interfaces';
import { TranslateService } from '@ngx-translate/core';
import { firstValueFrom } from 'rxjs';

import { SettingsService } from './settings.service';

/** Which language the interface is read in. */
@Injectable({ providedIn: 'root' })
export class LanguageService {
	private readonly settings = inject(SettingsService);
	private readonly translate = inject(TranslateService);

	/** Every language on offer, with the name it calls itself by. */
	readonly available = LANGUAGES.map((code) => ({
		code,
		name: LANGUAGE_NAMES[code],
		flag: LANGUAGE_FLAGS[code],
	}));

	readonly current = this.settings.language.asReadonly();

	constructor() {
		effect(() => {
			const language = this.settings.language();
			this.translate.use(language);
			globalThis.document?.documentElement?.setAttribute('lang', language);
		});
	}

	/** Loads the stored language before the first paint. */
	async load(): Promise<void> {
		const language = this.settings.language();
		globalThis.document?.documentElement?.setAttribute('lang', language);
		try {
			await firstValueFrom(this.translate.use(language));
		} catch {}
	}

	set(language: Language): void {
		this.settings.language.set(language);
	}
}

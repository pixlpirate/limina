import { effect, inject, Injectable } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslateService } from '@ngx-translate/core';

/** Page titles read "screen – app". */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
	private readonly title = inject(Title);
	private readonly translate = inject(TranslateService);

	private latest: RouterStateSnapshot | null = null;

	constructor() {
		super();
		effect(() => {
			this.translate.currentLang();
			if (this.latest) {
				this.apply(this.latest);
			}
		});
	}

	override updateTitle(snapshot: RouterStateSnapshot): void {
		this.latest = snapshot;
		this.apply(snapshot);
	}

	private apply(snapshot: RouterStateSnapshot): void {
		const app = this.translate.instant('app.name') as string;
		const key = this.buildTitle(snapshot);
		const page = key ? (this.translate.instant(key) as string) : '';
		this.title.setTitle(page ? `${page} – ${app}` : app);
	}
}

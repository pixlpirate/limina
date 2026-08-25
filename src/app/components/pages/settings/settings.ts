import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { LabelSize, Language, LightSource, Units } from '@interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import {
	LanguageService,
	ModalService,
	OfflineCacheService,
	OfflineService,
	SettingsService,
} from '@services';

import { NumberField, Panel } from '../../molecules';

@Component({
	selector: 'app-settings',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [NumberField, Panel, ReactiveFormsModule, TranslatePipe],
	templateUrl: './settings.html',
	styleUrl: './settings.scss',
})
export class Settings {
	private readonly settings = inject(SettingsService);
	private readonly modal = inject(ModalService);
	private readonly cache = inject(OfflineCacheService);
	private readonly offline = inject(OfflineService);
	private readonly languages_ = inject(LanguageService);

	/** Line weight, kept in step with the stored setting */
	protected readonly outlineWidth = new FormControl<number>(this.settings.outlineWidth(), {
		nonNullable: true,
	});

	constructor() {
		this.outlineWidth.valueChanges.pipe(takeUntilDestroyed()).subscribe((width) => {
			if (Number.isFinite(width)) {
				this.settings.outlineWidth.set(Math.min(Math.max(width, 0), 2));
			}
		});
	}

	protected readonly usage = this.cache.usage;
	protected readonly storing = this.offline.storing;
	protected readonly progress = this.offline.progress;

	protected readonly showSun = this.settings.showSun;
	protected readonly showMoon = this.settings.showMoon;
	protected readonly showPeakElevation = this.settings.showPeakElevation;
	protected readonly showRanges = this.settings.showRanges;
	protected readonly showMilkyWay = this.settings.showMilkyWay;
	protected readonly labelSize = this.settings.labelSize;
	protected readonly units = this.settings.units;

	protected readonly labelSizes: LabelSize[] = ['small', 'medium', 'large'];
	protected readonly languages = this.languages_.available;
	protected readonly language = this.languages_.current;

	protected toggleBody(body: LightSource): void {
		this.settings.toggle(body);
	}

	protected togglePeakElevation(): void {
		this.settings.showPeakElevation.update((shown) => !shown);
	}

	protected toggleRanges(): void {
		this.settings.showRanges.update((shown) => !shown);
	}

	protected toggleMilkyWay(): void {
		this.settings.showMilkyWay.update((shown) => !shown);
	}

	protected setLabelSize(value: LabelSize): void {
		this.settings.labelSize.set(value);
	}

	protected setUnits(value: Units): void {
		this.settings.units.set(value);
	}

	protected setLanguage(value: Language): void {
		this.languages_.set(value);
	}

	protected store(): void {
		void this.offline.storeCurrentArea();
	}

	protected async clear(): Promise<void> {
		const agreed = await this.modal.confirm(
			'settings.clearMessage',
			{},
			'settings.clearAction',
			'settings.clearTitle',
		);
		if (agreed) {
			await this.cache.clear();
		}
	}

	protected megabytes(bytes: number): string {
		return (bytes / 1_048_576).toFixed(1);
	}
}

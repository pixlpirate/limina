import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Peak } from '@interfaces';
import { TranslatePipe } from '@ngx-translate/core';
import { BearingPipe, LengthPipe } from '@pipes';
import { CameraService, MenuService, PeaksService, ViewpointService } from '@services';
import { DEG } from '@utils';

import { Panel, Table, TableColumn } from '../../molecules';

@Component({
	selector: 'app-summits',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [Panel, Table, TranslatePipe],
	providers: [BearingPipe, LengthPipe],
	templateUrl: './summits.html',
})
export class Summits {
	private readonly peaks = inject(PeaksService);
	private readonly camera = inject(CameraService);
	private readonly router = inject(Router);
	private readonly menu = inject(MenuService);
	private readonly viewpoint = inject(ViewpointService);
	private readonly bearing = inject(BearingPipe);
	private readonly length = inject(LengthPipe);

	protected readonly summits = this.peaks.visiblePeaks;
	protected readonly loading = this.peaks.loading;
	protected readonly error = this.peaks.error;

	protected readonly columns: TableColumn<Peak>[] = [
		{ key: 'name', label: 'summits.name', rowHeader: true, text: (peak) => peak.name },
		{
			key: 'elevation',
			label: 'summits.altitude',
			text: (peak) => this.length.transform(peak.elevation),
			value: (peak) => peak.elevation,
		},
		{
			key: 'distance',
			secondary: true,
			label: 'summits.distance',
			text: (peak) => this.length.transform(peak.distance, 'distance'),
			value: (peak) => peak.distance,
		},
		{
			key: 'bearing',
			secondary: true,
			label: 'summits.direction',
			text: (peak) => this.bearing.transform(peak.bearing),
			value: (peak) => peak.bearing,
		},
	];

	/**
	 * Swings the view round to a summit and stands aside, since this screen
	 * covers the landscape it has just aimed at.
	 */
	protected look(summit: Peak): void {
		this.menu.forget();
		const rise = summit.up - this.camera.altitude();
		this.camera.lookAt(summit.bearing, Math.atan2(rise, summit.distance) / DEG);
		void this.router.navigate(['/']);
	}

	/** Moves the viewpoint onto the summit */
	protected flyTo(summit: Peak): void {
		this.menu.forget();
		this.viewpoint.moveTo({ lat: summit.lat, lon: summit.lon }, 'summit', summit.name);
		void this.router.navigate(['/']);
	}

	protected reload(): void {
		this.peaks.reload();
	}
}

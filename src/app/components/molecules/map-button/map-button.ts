import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

/** Shortcut to the map */
@Component({
	selector: 'app-map-button',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [RouterLink, TranslatePipe],
	templateUrl: './map-button.html',
})
export class MapButton {}

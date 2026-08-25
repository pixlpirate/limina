import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

/**
 * Route shell for the ways of choosing a viewpoint. Each way brings its own
 * panel, so it can title itself and put its own controls in the header.
 */
@Component({
	selector: 'app-viewpoint',
	changeDetection: ChangeDetectionStrategy.OnPush,
	imports: [RouterOutlet],
	template: '<router-outlet />',
})
export class Viewpoint {}

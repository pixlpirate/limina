import { Routes } from '@angular/router';

/** Route titles are translation keys; {@link AppTitleStrategy} resolves them. */
export const routes: Routes = [
	{ path: '', pathMatch: 'full', children: [] },
	{
		path: 'viewpoint',
		title: 'nav.viewpoint',
		loadComponent: () =>
			import('./components/pages/viewpoint/viewpoint').then((m) => m.Viewpoint),
		children: [
			{ path: '', pathMatch: 'full', redirectTo: 'map' },
			{
				path: 'map',
				loadComponent: () =>
					import('./components/pages/viewpoint/map/map').then((m) => m.ViewpointMap),
			},
			{
				path: 'coordinates',
				loadComponent: () =>
					import('./components/pages/viewpoint/coordinates/coordinates').then(
						(m) => m.ViewpointCoordinates,
					),
			},
			{
				path: 'bookmarks',
				loadComponent: () =>
					import('./components/pages/viewpoint/bookmarks/bookmarks').then(
						(m) => m.ViewpointBookmarks,
					),
			},
			{
				path: 'latlon',
				loadComponent: () =>
					import('./components/pages/viewpoint/lat-lon/lat-lon').then(
						(m) => m.ViewpointLatLon,
					),
			},
		],
	},
	{
		path: 'summits',
		title: 'nav.summits',
		loadComponent: () => import('./components/pages/summits/summits').then((m) => m.Summits),
	},
	{
		path: 'settings',
		title: 'nav.settings',
		loadComponent: () => import('./components/pages/settings/settings').then((m) => m.Settings),
	},
	{
		path: 'celestial',
		title: 'nav.celestial',
		loadComponent: () =>
			import('./components/pages/celestial/celestial').then((m) => m.Celestial),
	},
	{
		path: 'info',
		title: 'nav.info',
		loadChildren: () => import('./components/pages/info/info.routes').then((m) => m.routes),
	},
	{ path: '**', redirectTo: '' },
];

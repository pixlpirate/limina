# Limina

## Introduction

**Limina names the mountains you can see.**

Limina draws the mountain skyline from any viewpoint and names the peaks you can actually see. It also shows the sun and moon, including their rise and set over the mountain skyline. Areas can be stored while connected to Wi-Fi and viewed later without a connection.

Live version: [limina.pixelpirate.fr](https://limina.pixelpirate.fr)

## Contributions

You can contribute to the application by creating a pull request. Contributions are welcome, including:

- Improvements and corrections
- New features
- Improvements to elevation or summit data
- New translations
- Documentation

If you're not familiar with coding, feel free to leave a message in the Issues or Discussions section.

## Development

This project is developed with [Angular](https://angular.dev/).

### Prerequisites

Make sure you have the following installed:

1. **Node.js & npm:** Download it [from here](https://nodejs.org/)
2. **Angular CLI:** Install it with:

    ```
    npm install -g @angular/cli
    ```

### Getting started

1. Clone the repository:

    ```
    git clone https://github.com/pixlpirate/limina.git
    cd limina
    ```

2. Install project dependencies:

    ```
    npm install
    ```

3. Run the development server:

    ```
    ng serve
    ```

4. Open `http://localhost:4200/` in your browser. The application will automatically reload if you change any of the source files.

### Build

Run `ng build` to build the project. The build artifacts will be stored in the `dist/` directory.

## Data

Limina uses open elevation and summit data to generate its views.

The application calculates visibility using the terrain between the viewpoint and each summit, so mountains hidden behind closer terrain are excluded from the rendered skyline.

## License

This project is distributed under the GNU GPLv3 license.
You can redistribute and/or modify it under the terms of the GNU General Public License as published by the Free Software Foundation. More information is available in the attached license file.

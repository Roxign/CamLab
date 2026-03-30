const viewChessboardBtn = document.getElementById('viewChessboard');
const chessCanvas = document.getElementById('canvas');
const chessCtx = chessCanvas.getContext('2d');
chessCanvas._undistortTable = null;

const world2camBtn = document.getElementById('world2cam');
const cam2worldBtn = document.getElementById('cam2world');
const centerAtTLBtn = document.getElementById('centerAtTL');
const centerAtCTBtn = document.getElementById('centerAtCenter');

const viewCurveBtn = document.getElementById('viewCurve');
const curveCanvas = document.getElementById('curveCanvas');
const curveCtx = curveCanvas.getContext('2d');

const curveAxisOptions = document.getElementById('curveAxisOptions');
const curveDirectionAngleSlider = document.getElementById('curveDirectionAngle');
const curveDirectionAngleText = document.getElementById('curveDirectionAngleText');
const curveDirectionPresetButtons = Array.from(document.querySelectorAll('[data-curve-direction-target]'));
const directionCanvas = document.getElementById('directionCanvas');
const directionCtx = directionCanvas.getContext('2d');

const DIRECTION_CANVAS_MAX_WIDTH = 220;
const DIRECTION_CANVAS_MAX_HEIGHT = 124;

const curveDirectionState = {
    stopU: null,
    stopV: null
};

const curveAxisKeys = ['x', 'y'];

const curveAxes = Object.fromEntries(curveAxisKeys.map(axisKey => {
    const typeOptions = Array.from(document.querySelectorAll(`input[data-curve-axis="${axisKey}"][data-curve-role="type"]`));
    const unitOptions = Array.from(document.querySelectorAll(`input[data-curve-axis="${axisKey}"][data-curve-role="unit"]`));
    const unitGroup = document.querySelector(`[data-curve-axis="${axisKey}"][data-curve-role="unit-group"]`);
    // Only two types now: angle and height
    const labels = Object.fromEntries(typeOptions.map(option => [option.value, option.dataset.axisLabel || option.value]));

    return [axisKey, {
        unitGroup,
        typeOptions,
        unitOptions,
        labels,
        state: {
            type: (typeOptions.find(option => option.checked) || typeOptions[0])?.value || 'angle',
            unit: (unitOptions.find(option => option.checked) || unitOptions[0])?.value || 'deg'
        }
    }];
}));

// Initial Parameters
let rx_wc = 0, ry_wc = 0, rz_wc = 0, tx_wc = 0, ty_wc = 0, tz_wc = 1000;
let rx_cw = 0, ry_cw = 0, rz_cw = 0, tx_cw = 0, ty_cw = 0, tz_cw = -1000;

function getIntrinsics() {
    return [
        parseFloat(document.getElementById('psText').value),
        parseFloat(document.getElementById('iw').value),
        parseFloat(document.getElementById('ih').value),
        parseFloat(document.getElementById('fx').value),
        parseFloat(document.getElementById('fy').value),
        parseFloat(document.getElementById('cx').value),
        parseFloat(document.getElementById('cy').value)
    ];
}

function getDistortion() {
    return [
        parseFloat(document.getElementById('k1').value),
        parseFloat(document.getElementById('k2').value),
        parseFloat(document.getElementById('p1').value),
        parseFloat(document.getElementById('p2').value),
        parseFloat(document.getElementById('k3').value),
        parseFloat(document.getElementById('k4').value),
        parseFloat(document.getElementById('k5').value),
        parseFloat(document.getElementById('k6').value),
        document.getElementById('fisheye').checked
    ];
}

function getChessboardSettings() {
    return [
        parseFloat(document.getElementById('bc').value),
        parseFloat(document.getElementById('br').value),
        parseFloat(document.getElementById('bw').value),
        parseFloat(document.getElementById('bh').value),
        centerAtCTBtn.classList.contains('active'),
        document.getElementById('showSquares').checked,
        document.getElementById('showCircles').checked
    ];
}

function updateChessboardOriginTabs(mode = 'center') {
    const isCenter = mode === 'center';
    centerAtCTBtn.classList.toggle('active', isCenter);
    centerAtTLBtn.classList.toggle('active', !isCenter);
    centerAtCTBtn.setAttribute('aria-selected', isCenter ? 'true' : 'false');
    centerAtTLBtn.setAttribute('aria-selected', isCenter ? 'false' : 'true');
}

function toggleChessUI(enabled) {
    viewChessboardBtn.classList.toggle('active', enabled);
    viewChessboardBtn.setAttribute('aria-selected', enabled ? 'true' : 'false');
    if (enabled) {
        viewCurveBtn.classList.remove('active');
        viewCurveBtn.setAttribute('aria-selected', 'false');
        chessCanvas.classList.remove('hidden');
        chessCanvas.style.display = 'block';
    } else {
        chessCanvas.classList.add('hidden');
        chessCanvas.style.display = 'none';
    }
}

function toggleCurveUI(enabled) {
    viewCurveBtn.classList.toggle('active', enabled);
    viewCurveBtn.setAttribute('aria-selected', enabled ? 'true' : 'false');
    if (enabled) {
        viewChessboardBtn.classList.remove('active');
        viewChessboardBtn.setAttribute('aria-selected', 'false');
        curveAxisOptions.classList.remove('hidden');
        curveCanvas.classList.remove('hidden');
        curveCanvas.style.display = 'block';
    } else {
        curveAxisOptions.classList.add('hidden');
        curveCanvas.classList.add('hidden');
        curveCanvas.style.display = 'none';
    }
}

function updateExtrinsicModeButtons(mode = 'world2cam') {
    if (mode === 'world2cam') {
        world2camBtn.classList.add('active');
        cam2worldBtn.classList.remove('active');
        world2camBtn.setAttribute('aria-selected', 'true');
        cam2worldBtn.setAttribute('aria-selected', 'false');
    } else {
        cam2worldBtn.classList.add('active');
        world2camBtn.classList.remove('active');
        cam2worldBtn.setAttribute('aria-selected', 'true');
        world2camBtn.setAttribute('aria-selected', 'false');
    }
}

// Helper to convert Euler angles (in radians) to a rotation matrix (row-major order)
function eulerAnglesToRotationMatrix(rx, ry, rz) {
    let cosRx = Math.cos(rx), sinRx = Math.sin(rx);
    let cosRy = Math.cos(ry), sinRy = Math.sin(ry);
    let cosRz = Math.cos(rz), sinRz = Math.sin(rz);
    let R11 = cosRy * cosRz;
    let R12 = cosRy * sinRz;
    let R13 = -sinRy;
    let R21 = sinRx * sinRy * cosRz - cosRx * sinRz;
    let R22 = sinRx * sinRy * sinRz + cosRx * cosRz;
    let R23 = sinRx * cosRy;
    let R31 = cosRx * sinRy * cosRz + sinRx * sinRz;
    let R32 = cosRx * sinRy * sinRz - sinRx * cosRz;
    let R33 = cosRx * cosRy;
    return [R11, R12, R13, R21, R22, R23, R31, R32, R33];
}

// helper to convert a rotation matrix back into our Euler angles
function rotationMatrixToEulerAngles(R11, R12, R13, R21, R22, R23, R31, R32, R33) {
    let ry = -Math.asin(R13);
    let rz = Math.atan2(R12, R11);
    let rx = Math.atan2(R23, R33);
    return [rx, ry, rz];
}

// apply distortion to normalized coordinates (xc/zc, yc/zc) based on current distortion parameters and mode. This implements both the KB fisheye model and the standard radial+tangential model, which can be toggled with the "KB" checkbox. The fisheye model is based on the angle of the incoming ray, while the standard model is based on the radius in the normalized image plane, so they produce different distortion patterns.
function applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    // Comments are the original perspective division, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
    // let xp = xc / zc;
    // let yp = yc / zc;
    let xp = xc / Math.abs(zc);
    let yp = yc / Math.abs(zc);
    if (fisheye) {
        let r = Math.sqrt(xp * xp + yp * yp);
        if (r > 0) {
            // Comments are the original fisheye distortion formula, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using atan2 with absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
            // let theta1 = Math.atan(Math.sqrt(xc * xc + yc * yc) / zc);
            let theta1 = Math.atan2(Math.sqrt(xc * xc + yc * yc), zc);
            let theta2 = theta1 * theta1;
            let theta3 = theta2 * theta1;
            let theta5 = theta2 * theta3;
            let theta7 = theta2 * theta5;
            let theta9 = theta2 * theta7;
            let theta_d = theta1 + k1 * theta3 + k2 * theta5 + k3 * theta7 + k4 * theta9;
            xp = (theta_d / r) * xp;
            yp = (theta_d / r) * yp;
        }
    }
    else {
        let r2 = xp * xp + yp * yp;
        let r4 = r2 * r2;
        let r6 = r4 * r2;
        let radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / (1 + k4 * r2 + k5 * r4 + k6 * r6);
        let dtx = 2 * p1 * xp * yp + p2 * (r2 + 2 * xp * xp);
        let dty = p1 * (r2 + 2 * yp * yp) + 2 * p2 * xp * yp;
        xp = xp * radial + dtx;
        yp = yp * radial + dty;
    }
    return [xp, yp];
}

function projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    // compute rotation matrix once and reuse (world->camera case)
    let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);

    // Apply rotation & translation (world->camera)
    let [xw, yw, zw] = p3d;
    let xc = R11 * xw + R12 * yw + R13 * zw + tx_wc;
    let yc = R21 * xw + R22 * yw + R23 * zw + ty_wc;
    let zc = R31 * xw + R32 * yw + R33 * zw + tz_wc;

    // normalize and apply distortion
    let [xp, yp] = applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);

    // apply intrinsics
    let u = fx * xp + cx;
    let v = fy * yp + cy;

    // scale to canvas size (this allows the intrinsic parameters to be specified in terms of an arbitrary image size, independent of the canvas display size)
    u = u * chessCanvas.width / iw;
    v = v * chessCanvas.height / ih;
    return [u, v, zc];
}

// invert distorted normalized coordinates. Returns [x, y, z], where x and y are normalized by |z|, and z indicates ray hemisphere (+1 front, -1 back).
// For fisheye mode, this includes solving the fisheye incident angle directly and deriving z from whether theta exceeds 90 degrees.
function undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, maxIter = 30, eps = 1e-2) {
    if (fisheye) {
        const thetaDist = Math.hypot(xDist, yDist);
        if (thetaDist === 0) {
            return [0, 0, 1];
        }

        let theta = Math.min(thetaDist, Math.PI - 1e-6);
        for (let i = 0; i < maxIter; i++) {
            const t2 = theta * theta;
            const t3 = t2 * theta;
            const t4 = t2 * t2;
            const t5 = t3 * t2;
            const t6 = t3 * t3;
            const t7 = t4 * t3;
            const t8 = t4 * t4;
            const t9 = t5 * t4;

            const f = theta + k1 * t3 + k2 * t5 + k3 * t7 + k4 * t9 - thetaDist;
            const df = 1 + 3 * k1 * t2 + 5 * k2 * t4 + 7 * k3 * t6 + 9 * k4 * t8;

            if (!isFinite(df) || Math.abs(df) < 1e-14) {
                break;
            }

            const step = f / df;
            theta -= step;
            theta = Math.max(0, Math.min(theta, Math.PI - 1e-6));
            if (Math.abs(step) < 1e-12) {
                break;
            }
        }

        const z = theta > Math.PI * 0.5 ? -1 : 1;
        const frontTheta = z > 0 ? theta : (Math.PI - theta);
        const r = Math.tan(frontTheta);
        const scale = r / thetaDist;
        return [xDist * scale, yDist * scale, z];
    }

    const lambdaInit = 1e-3;
    let lambda = lambdaInit;
    const maxLambda = 1e16;

    // initial guess
    let x = xDist, y = yDist;
    let out = applyDistortion(x, y, 1, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    let r0 = out[0] - xDist, r1 = out[1] - yDist;
    let cost = r0 * r0 + r1 * r1;

    for (let iter = 0; iter < maxIter; ++iter) {
        // Jacobian J = d(xp,yp)/d(x,y)
        let J00, J01, J10, J11;

        const r2 = x * x + y * y;
        const r4 = r2 * r2;
        const r6 = r4 * r2;
        const N = 1 + k1 * r2 + k2 * r4 + k3 * r6;
        const D = 1 + k4 * r2 + k5 * r4 + k6 * r6;
        const Np = k1 + 2 * k2 * r2 + 3 * k3 * r4;
        const Dp = k4 + 2 * k5 * r2 + 3 * k6 * r4;
        const dradial_dr2 = (Np * D - N * Dp) / (D * D);
        const radial = N / D;
        const dradial_dx = dradial_dr2 * 2 * x;
        const dradial_dy = dradial_dr2 * 2 * y;
        const dtx_dx = 2 * p1 * y + 6 * p2 * x;
        const dtx_dy = 2 * p1 * x + 2 * p2 * y;
        const dty_dx = 2 * p1 * x + 2 * p2 * y;
        const dty_dy = 6 * p1 * y + 2 * p2 * x;
        J00 = radial + x * dradial_dx + dtx_dx;
        J01 = x * dradial_dy + dtx_dy;
        J10 = y * dradial_dx + dty_dx;
        J11 = radial + y * dradial_dy + dty_dy;

        // JTJ and JTr
        const JTJ00 = J00 * J00 + J10 * J10;
        const JTJ01 = J00 * J01 + J10 * J11;
        const JTJ11 = J01 * J01 + J11 * J11;
        const JTr0 = J00 * r0 + J10 * r1;
        const JTr1 = J01 * r0 + J11 * r1;

        // Damped Hessian (scale lambda by diag)
        const H00 = JTJ00 * (1 + lambda);
        const H01 = JTJ01;
        const H10 = JTJ01;
        const H11 = JTJ11 * (1 + lambda);

        // solve 2x2
        let dx, dy;
        {
            let a00 = H00, a01 = H01, a10 = H10, a11 = H11;
            let b0 = -JTr0, b1 = -JTr1;
            let det = a00 * a11 - a01 * a10;
            if (Math.abs(det) > 1e-24) {
                const inv = 1.0 / det;
                dx = (a11 * b0 - a01 * b1) * inv;
                dy = (-a10 * b0 + a00 * b1) * inv;
            } else {
                const reg = 1e-8;
                a00 += reg; a11 += reg;
                det = a00 * a11 - a01 * a10;
                if (Math.abs(det) < 1e-30) { dx = 0; dy = 0; }
                else {
                    const inv = 1.0 / det;
                    dx = (a11 * b0 - a01 * b1) * inv;
                    dy = (-a10 * b0 + a00 * b1) * inv;
                }
            }
        }

        if (!isFinite(dx) || !isFinite(dy) || Math.abs(dx) > 1e6 || Math.abs(dy) > 1e6) {
            lambda = Math.min(lambda * 10, maxLambda);
            if (lambda >= maxLambda) break;
            continue;
        }

        const xT = x + dx, yT = y + dy;
        out = applyDistortion(xT, yT, 1, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        const r0t = out[0] - xDist, r1t = out[1] - yDist;
        const costT = r0t * r0t + r1t * r1t;

        if (costT < cost) {
            x = xT; y = yT; r0 = r0t; r1 = r1t;
            cost = costT;
            lambda = Math.max(lambda * 0.1, 1e-16);
            if (dx * dx + dy * dy < eps) break;
        } else {
            lambda = Math.min(lambda * 10, maxLambda);
            if (lambda >= maxLambda) break;
        }
    }

    return [x, y, 1];
}

// precompute the undistortion table for each pixel in the canvas. This allows us to quickly look up the corresponding undistorted ray direction for each pixel when rendering the chessboard squares, without having to run the iterative undistortion process for every pixel on every frame. The table is updated whenever the intrinsics or distortion parameters change, since those affect the mapping from distorted image coordinates to undistorted ray directions.
function updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    let width = chessCanvas.width;
    let height = chessCanvas.height;
    let dx = new Float32Array(width * height);
    let dy = new Float32Array(width * height);
    let dz = new Float32Array(width * height);

    const fxCanvas = fx * width / iw;
    const fyCanvas = fy * height / ih;
    const cxCanvas = cx * width / iw;
    const cyCanvas = cy * height / ih;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            let xDist = (u - cxCanvas) / fxCanvas;
            let yDist = (v - cyCanvas) / fyCanvas;
            let [xu, yu, zu] = undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            let idx = v * width + u;
            dx[idx] = xu;
            dy[idx] = yu;
            dz[idx] = zu;
        }
    }
    return [dx, dy, dz, width, height];
}

// render the chessboard and corners based on current parameters. If "showSquares" is enabled, it uses the undistortion table to determine the color of each pixel by raycasting from the camera through the distorted image plane into the world to see what color it hits on the chessboard. If "showCircles" is enabled, it projects the 3D corner points and draws filled circles at their locations, colored red if they are in front of the camera and blue if they are behind, which helps visualize how the extrinsic parameters affect the projection of points in space.
function renderChessboard() {
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, showSquares, showCircles] = getChessboardSettings();
    chessCtx.clearRect(0, 0, chessCanvas.width, chessCanvas.height);

    if (showSquares) {
        let width = chessCanvas.width, height = chessCanvas.height;
        let img = chessCtx.getImageData(0, 0, width, height);
        let data = img.data;
        if (!chessCanvas._undistortTable) {
            chessCanvas._undistortTable = updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        }
        let [dxTable, dyTable, dzTable] = chessCanvas._undistortTable;

        let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);
        let x_min = center ? -(bc + 1) / 2 : -1;
        let x_max = center ? (bc + 1) / 2 : bc;
        let y_min = center ? -(br + 1) / 2 : -1;
        let y_max = center ? (br + 1) / 2 : br;
        x_min *= bw; x_max *= bw;
        y_min *= bh; y_max *= bh;

        for (let v = 0; v < height; v++) {
            for (let u = 0; u < width; u++) {
                let idx = v * width + u;
                let dx = dxTable[idx];
                let dy = dyTable[idx];
                let dz = dzTable[idx];

                let dwx = R11 * dx + R12 * dy + R13 * dz;
                let dwy = R21 * dx + R22 * dy + R23 * dz;
                let dwz = R31 * dx + R32 * dy + R33 * dz;

                if (dwz !== 0) {
                    let s = -tz_cw / dwz;
                    if (s > 0) {
                        let X = tx_cw + s * dwx;
                        let Y = ty_cw + s * dwy;
                        if (X >= x_min && X <= x_max && Y >= y_min && Y <= y_max) {
                            let xi = Math.floor((X - x_min) / bw);
                            let yi = Math.floor((Y - y_min) / bh);
                            let color = ((xi + yi) % 2 === 0) ? 255 : 0;
                            let pixel = idx * 4;
                            data[pixel + 0] = color;
                            data[pixel + 1] = color;
                            data[pixel + 2] = color;
                            data[pixel + 3] = 255;
                        }
                    }
                }
            }
        }
        chessCtx.putImageData(img, 0, 0);
    }

    if (showCircles) {
        const xMin = center ? -(bc - 1) / 2 : 0;
        const xMax = center ? bc / 2 : bc;
        const yMin = center ? -(br - 1) / 2 : 0;
        const yMax = center ? br / 2 : br;
        for (let y = yMin; y < yMax; y++) {
            for (let x = xMin; x < xMax; x++) {
                const p3d = [x * bw, y * bh, 0];
                const [u, v, zc] = projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
                chessCtx.fillStyle = zc > 0 ? "red" : "blue";
                chessCtx.beginPath();
                chessCtx.arc(u, v, 3, 0, 2 * Math.PI);
                chessCtx.fill();
            }
        }
    }
}

function syncCurveAxisUnitVisibility(axisKey) {
    const axis = curveAxes[axisKey];
    const { state } = axis;
    const activeUnits = axis.unitOptions
        .filter(option => option.dataset.unitKind === state.type)
        .map(option => option.value);

    axis.unitGroup.classList.toggle('hidden', activeUnits.length === 0);
    axis.unitOptions.forEach(option => {
        const enabled = activeUnits.includes(option.value);
        const label = option.closest('label');
        if (label) {
            label.classList.toggle('hidden', !enabled);
            label.classList.toggle('disabled-option', !enabled);
        }
        option.disabled = !enabled;
        if (!enabled && option.checked) {
            option.checked = false;
        }
    });

    if (activeUnits.length > 0 && !activeUnits.includes(state.unit)) {
        state.unit = activeUnits[0];
    }

    axis.unitOptions.forEach(option => {
        option.checked = !option.disabled && option.value === state.unit;
    });
}

const getCurveAxisLabel = axisKey => `${curveAxes[axisKey].labels[curveAxes[axisKey].state.type] || curveAxes[axisKey].state.type} (${curveAxes[axisKey].state.unit})`;

function getCurveAxisValue(axisKey, slope, rayZ, focalLengthPx, pixelSizeUm) {
    const { state } = curveAxes[axisKey];
    if (state.type === 'angle') {
        const frontAngle = Math.atan(slope);
        const angleRad = axisKey === 'x' && rayZ < 0 ? (Math.PI - frontAngle) : frontAngle;
        switch (state.unit) {
            case 'rad':
                return angleRad;
            case 'deg':
                return angleRad * 180 / Math.PI;
            case 'slope':
                return slope;
            default:
                return angleRad * 180 / Math.PI;
        }
    }
    if (state.type === 'height') {
        const heightPixel = focalLengthPx * slope;
        const pixelPitchUm = isFinite(pixelSizeUm) && pixelSizeUm > 0 ? pixelSizeUm : 1;
        const heightUm = heightPixel * pixelPitchUm;
        switch (state.unit) {
            case 'pixel':
                return heightPixel;
            case 'um':
                return heightUm;
            case 'mm':
                return heightUm / 1e3;
            case 'cm':
                return heightUm / 1e4;
            case 'm':
            default:
                return heightUm / 1e6;
        }
    }
    // Should never reach here
    return NaN;
}

function bindCurveAxisControls(axisKey) {
    const axis = curveAxes[axisKey];
    axis.typeOptions.forEach(option => {
        option.addEventListener('change', function () {
            axis.state.type = this.value;
            syncCurveAxisUnitVisibility(axisKey);
            refreshCurveChart();
        });
    });

    axis.unitOptions.forEach(option => {
        option.addEventListener('change', function () {
            axis.state.unit = this.value;
            refreshCurveChart();
        });
    });
}

function normalizeDirectionAngleDeg(angleDeg) {
    if (!isFinite(angleDeg)) return 0;
    let wrapped = angleDeg % 360;
    if (wrapped > 180) wrapped -= 360;
    if (wrapped < -180) wrapped += 360;
    return wrapped;
}

function setCurveDirectionAngle(angleDeg) {
    const normalized = normalizeDirectionAngleDeg(angleDeg);
    curveDirectionAngleSlider.value = normalized;
    curveDirectionAngleText.value = normalized;
    refreshCurveChart();
}

function setCurveDirectionFromPreset(target) {
    const [, iw, ih, , , cx, cy] = getIntrinsics();
    if (!isFinite(iw) || !isFinite(ih) || !isFinite(cx) || !isFinite(cy)) {
        return;
    }

    const targets = {
        T: [cx, 0],
        TR: [iw, 0],
        R: [iw, cy],
        BR: [iw, ih],
        B: [cx, ih],
        BL: [0, ih],
        L: [0, cy],
        TL: [0, 0]
    };

    const targetPoint = targets[target];
    if (!targetPoint) {
        return;
    }

    const [targetU, targetV] = targetPoint;
    const deltaU = targetU - cx;
    const deltaV = targetV - cy;
    if (Math.abs(deltaU) < 1e-12 && Math.abs(deltaV) < 1e-12) {
        return;
    }

    const angleDeg = Math.atan2(-deltaV, deltaU) * 180 / Math.PI;
    setCurveDirectionAngle(angleDeg);
}

function getCurveDirectionUnitVector() {
    const directionDeg = parseFloat(curveDirectionAngleSlider.value);
    const directionRad = directionDeg * Math.PI / 180;
    const dirX = Math.cos(directionRad);
    const dirY = -Math.sin(directionRad);
    const norm = Math.hypot(dirX, dirY) || 1;
    return [dirX / norm, dirY / norm];
}

function renderDirectionCanvas() {
    const [, iw, ih, , , cx, cy] = getIntrinsics();
    if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0) {
        directionCanvas.width = DIRECTION_CANVAS_MAX_WIDTH;
        directionCanvas.height = DIRECTION_CANVAS_MAX_HEIGHT;
        directionCanvas.style.width = `${DIRECTION_CANVAS_MAX_WIDTH}px`;
        directionCanvas.style.height = `${DIRECTION_CANVAS_MAX_HEIGHT}px`;
    } else {
        const scale = Math.min(DIRECTION_CANVAS_MAX_WIDTH / iw, DIRECTION_CANVAS_MAX_HEIGHT / ih, 1);
        const displayWidth = Math.max(1, Math.round(iw * scale));
        const displayHeight = Math.max(1, Math.round(ih * scale));
        directionCanvas.width = displayWidth;
        directionCanvas.height = displayHeight;
        directionCanvas.style.width = `${displayWidth}px`;
        directionCanvas.style.height = `${displayHeight}px`;
    }

    const width = directionCanvas.width;
    const height = directionCanvas.height;
    directionCtx.clearRect(0, 0, width, height);
    directionCtx.fillStyle = '#ffffff';
    directionCtx.fillRect(0, 0, width, height);

    directionCtx.strokeStyle = '#000000';
    directionCtx.lineWidth = 1;
    directionCtx.strokeRect(0.5, 0.5, width - 1, height - 1);

    const scaleX = width / iw;
    const scaleY = height / ih;
    const centerX = cx * scaleX;
    const centerY = cy * scaleY;

    directionCtx.strokeStyle = '#bbbbbb';
    directionCtx.beginPath();
    directionCtx.moveTo(0, centerY + 0.5);
    directionCtx.lineTo(width, centerY + 0.5);
    directionCtx.moveTo(centerX + 0.5, 0);
    directionCtx.lineTo(centerX + 0.5, height);
    directionCtx.stroke();

    directionCtx.fillStyle = '#0b63f6';
    directionCtx.beginPath();
    directionCtx.arc(centerX, centerY, 3, 0, 2 * Math.PI);
    directionCtx.fill();


    const [dirX, dirY] = getCurveDirectionUnitVector();

    // Always use findFovLimit to determine the max arrow length in this direction
    let arrowDistance = 0;
    const fovLimitRad = findFovLimit(dirX, dirY);
    // For a given direction, the distance in the image plane is tan(angle) (slope)
    // Project the endpoint in normalized coordinates, then map to image plane
    const rayZ = fovLimitRad > Math.PI * 0.5 ? -1 : 1;
    const incomingSlope = Math.tan(rayZ > 0 ? fovLimitRad : (Math.PI - fovLimitRad));
    const xu = dirX * incomingSlope;
    const yu = dirY * incomingSlope;
    // Apply distortion and intrinsics to get image coordinates
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [ , , , fx, fy, cx_, cy_ ] = getIntrinsics();
    const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    const u = fx * xDist + cx_;
    const v = fy * yDist + cy_;
    // Distance from (cx, cy) to (u, v) in image coordinates
    arrowDistance = Math.hypot(u - cx_, v - cy_);
    // Map to canvas scale
    arrowDistance *= scaleX; // assume scaleX ~ scaleY

    // Compute endpoint
    const endX = centerX + dirX * arrowDistance;
    const endY = centerY + dirY * arrowDistance;

    directionCtx.strokeStyle = '#0b63f6';
    directionCtx.lineWidth = 2;
    directionCtx.beginPath();
    directionCtx.moveTo(centerX, centerY);
    directionCtx.lineTo(endX, endY);
    directionCtx.stroke();

    const headLength = 6;
    const angle = Math.atan2(endY - centerY, endX - centerX);
    directionCtx.beginPath();
    directionCtx.moveTo(endX, endY);
    directionCtx.lineTo(endX - headLength * Math.cos(angle - Math.PI / 6), endY - headLength * Math.sin(angle - Math.PI / 6));
    directionCtx.moveTo(endX, endY);
    directionCtx.lineTo(endX - headLength * Math.cos(angle + Math.PI / 6), endY - headLength * Math.sin(angle + Math.PI / 6));
    directionCtx.stroke();
}

function initCurveChart() {
    curveCanvas._curveChart = new Chart(curveCtx, {
        type: 'line',
        plugins: [{
            id: 'topRightPlotBorder',
            afterDraw(chart) {
                const { ctx, chartArea } = chart;
                if (!chartArea) return;
                ctx.save();
                ctx.strokeStyle = '#000000';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(chartArea.left, chartArea.top + 0.5);
                ctx.lineTo(chartArea.right, chartArea.top + 0.5);
                ctx.moveTo(chartArea.right - 0.5, chartArea.top);
                ctx.lineTo(chartArea.right - 0.5, chartArea.bottom);
                ctx.stroke();
                ctx.restore();
            }
        }],
        data: {
            datasets: [{
                label: 'y',
                data: [],
                borderColor: '#0b63f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0
            }, {
                label: 'y',
                data: [],
                borderColor: '#0b63f6',
                backgroundColor: '#0b63f6',
                pointRadius: 4,
                pointHoverRadius: 4,
                showLine: false
            }]
        },
        options: {
            animation: false,
            responsive: false,
            maintainAspectRatio: false,
            layout: {
                padding: {
                    left: 6,
                    right: 6,
                    top: 6,
                    bottom: 2
                }
            },
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: getCurveAxisLabel('x'),
                        color: '#000000'
                    },
                    border: { color: '#000000', width: 1 },
                    grid: {
                        color: '#b0b0b0',
                        drawTicks: true,
                        tickLength: -4
                    },
                    ticks: {
                        color: '#000000',
                        maxTicksLimit: 16,
                        includeBounds: false,
                        padding: 8
                    }
                },
                y: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: getCurveAxisLabel('y'),
                        color: '#000000'
                    },
                    border: { color: '#000000', width: 1 },
                    grid: {
                        color: '#b0b0b0',
                        drawTicks: true,
                        tickLength: -4
                    },
                    ticks: {
                        color: '#000000',
                        maxTicksLimit: 12,
                        includeBounds: false,
                        padding: 8
                    }
                }
            }
        }
    });
}

// Find the maximum field of view angle in a given direction before the image leaves the sensor or the mapping becomes invalid.
function findFovLimit(rayDirX, rayDirY, incomingStepDeg = 0.09) {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    // Normalize direction
    const norm = Math.hypot(rayDirX, rayDirY);
    const dirX = norm === 0 ? 1 : rayDirX / norm;
    const dirY = norm === 0 ? 0 : rayDirY / norm;
    const incomingStepRad = incomingStepDeg * Math.PI / 180;
    const maxIncomingAngleRad = Math.PI - 1e-6;
    const maxSteps = Math.ceil(maxIncomingAngleRad / incomingStepRad) + 1;
    let previousReflectedAngle = null;
    let limitAngle = 0;
    for (let i = 0; i < maxSteps; i++) {
        const angle = Math.min(i * incomingStepRad, maxIncomingAngleRad);
        const rayZ = angle > Math.PI * 0.5 ? -1 : 1;
        const incomingSlope = Math.tan(rayZ > 0 ? angle : (Math.PI - angle));
        const xu = dirX * incomingSlope;
        const yu = dirY * incomingSlope;
        const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        const u = fx * xDist + cx;
        const v = fy * yDist + cy;
        const inResolution = u >= 0 && u <= iw && v >= 0 && v <= ih;
        if (!inResolution) {
            break;
        }
        const reflectedAngle = Math.atan(Math.hypot(xDist, yDist));
        if (previousReflectedAngle !== null && reflectedAngle < previousReflectedAngle) {
            // Curve reverses, stop here
            limitAngle = angle;
            break;
        }
        previousReflectedAngle = reflectedAngle;
        limitAngle = angle;
        if (angle >= maxIncomingAngleRad) {
            break;
        }
    }
    return limitAngle;
}

function updateFovResults() {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    // Horizontal FOV: left (-X) and right (+X)
    const h1 = findFovLimit(-1, 0);
    const h2 = findFovLimit(1, 0);
    const hFOV = (h1 + h2) * 180 / Math.PI;
    // Vertical FOV: up (-Y) and down (+Y)
    const v1 = findFovLimit(0, -1);
    const v2 = findFovLimit(0, 1);
    const vFOV = (v1 + v2) * 180 / Math.PI;
    // Diagonal FOV: four corners
    const d1 = findFovLimit(iw, ih) + findFovLimit(-iw, -ih);
    const d2 = findFovLimit(-iw, ih) + findFovLimit(iw, -ih);
    const dFOV = Math.min(d1, d2) * 180 / Math.PI;
    // Update DOM
    document.getElementById('hFOVResult').textContent = hFOV.toFixed(1);
    document.getElementById('vFOVResult').textContent = vFOV.toFixed(1);
    document.getElementById('dFOVResult').textContent = dFOV.toFixed(1);
}

function refreshCurveChart() {
    const curveChart = curveCanvas._curveChart;
    if (!curveChart) return;

    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const incomingStepDeg = 0.1;
    const incomingStepRad = incomingStepDeg * Math.PI / 180;
    const [rayDirX, rayDirY] = getCurveDirectionUnitVector();
    const ensureRange = (min, max) => (
        isFinite(min) && isFinite(max) && min !== max ? [min, max] : [0, 1]
    );

    // Use findFovLimit to get the FOV limit angle in this direction, using the same step as the curve
    const fovLimitRad = findFovLimit(rayDirX, rayDirY, incomingStepDeg);
    const extraRad = 10 * Math.PI / 180; // 10 degree extra
    const maxAngleRad = Math.min(fovLimitRad + extraRad, Math.PI - 1e-6);

    const points = [];
    let xMin = Infinity, xMax = -Infinity;
    let yMin = Infinity, yMax = -Infinity;
    let stopU = null, stopV = null;
    let fovPoint = null;

    for (let angle = 0; angle <= maxAngleRad + 1e-8; angle += incomingStepRad) {
        const rayZ = angle > Math.PI * 0.5 ? -1 : 1;
        const incomingSlope = Math.tan(rayZ > 0 ? angle : (Math.PI - angle));
        const xu = rayDirX * incomingSlope;
        const yu = rayDirY * incomingSlope;
        const [xDist, yDist] = applyDistortion(xu, yu, rayZ, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        const u = fx * xDist + cx;
        const v = fy * yDist + cy;
        const inResolution = u >= 0 && u <= iw && v >= 0 && v <= ih;
        if (!inResolution) break;
        stopU = u;
        stopV = v;
        const xValue = getCurveAxisValue('x', incomingSlope, rayZ, fx, pixelSizeUm);
        const yValue = getCurveAxisValue('y', Math.hypot(xDist, yDist), rayZ, fy, pixelSizeUm);
        if (!isFinite(xValue) || !isFinite(yValue)) continue;
        points.push({ x: xValue, y: yValue });
        xMin = Math.min(xMin, xValue);
        xMax = Math.max(xMax, xValue);
        yMin = Math.min(yMin, yValue);
        yMax = Math.max(yMax, yValue);
        // Mark the FOV point (at the limit, before extra 10 deg)
        if (!fovPoint && angle + 1e-8 >= fovLimitRad) fovPoint = { x: xValue, y: yValue };
    }

    [xMin, xMax] = ensureRange(xMin, xMax);
    [yMin, yMax] = ensureRange(yMin, yMax);
    const xPad = (xMax - xMin) * 0.05 || 0.05;
    const yPad = (yMax - yMin) * 0.1 || 0.1;

    curveChart.data.datasets[0].data = points;
    curveChart.options.scales.x.min = xMin - xPad;
    curveChart.options.scales.x.max = xMax + xPad;
    curveChart.options.scales.y.min = yMin - yPad;
    curveChart.options.scales.y.max = yMax + yPad;
    delete curveChart.options.scales.x.ticks.stepSize;
    delete curveChart.options.scales.y.ticks.stepSize;
    curveChart.data.datasets[1].data = fovPoint ? [fovPoint] : [];

    curveChart.options.scales.x.title.text = getCurveAxisLabel('x');
    curveChart.options.scales.y.title.text = getCurveAxisLabel('y');
    curveChart.update('none');
    curveDirectionState.stopU = stopU;
    curveDirectionState.stopV = stopV;
    renderDirectionCanvas();
}

// helper function to update parameter values and trigger a redraw when a slider or text box is changed. It takes the id of the parameter that was changed, updates the corresponding variable, and then calls drawPoints() to update the visualization. This function is called by both the slider and text box event handlers to keep them in sync and ensure that changes to either control update the parameter and redraw the scene.
function updateValuesFromSlider(id) {
    const slider = document.getElementById(id);
    const textBox = document.getElementById(id + "Text");
    if (textBox) {
        textBox.value = slider.value;
    }
    updateParameter(id, parseFloat(slider.value));
}

// similar to updateValuesFromSlider but triggered by changes to the text boxes. It updates the corresponding slider to keep them in sync, and then calls updateParameter() to update the parameter value and redraw the scene. This allows the user to either drag the slider or enter a specific value in the text box, and both controls will reflect the change while updating the visualization accordingly.
function updateValuesFromTextBox(id) {
    const textBox = document.getElementById(id + "Text");
    const slider = document.getElementById(id);
    if (slider) {
        slider.value = textBox.value;
    }
    updateParameter(id, parseFloat(textBox.value));
}

// given world->camera extrinsic parameters, compute the corresponding camera->world parameters for display in the UI when "inverse" mode is checked. This keeps the two sets of extrinsic parameters in sync so that the user can edit either one and see the correct corresponding values in the other.
function syncExtrinsicsFromWorldToCamera() {
    let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    [rx_cw, ry_cw, rz_cw] = rotationMatrixToEulerAngles(R11, R21, R31, R12, R22, R32, R13, R23, R33);
    tx_cw = -(R11 * tx_wc + R21 * ty_wc + R31 * tz_wc);
    ty_cw = -(R12 * tx_wc + R22 * ty_wc + R32 * tz_wc);
    tz_cw = -(R13 * tx_wc + R23 * ty_wc + R33 * tz_wc);
}

// given camera->world extrinsic parameters, compute the corresponding world->camera parameters for display in the UI when "inverse" mode is unchecked. This keeps the two sets of extrinsic parameters in sync so that the user can edit either one and see the correct corresponding values in the other.
function syncExtrinsicsFromCameraToWorld() {
    let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);
    [rx_wc, ry_wc, rz_wc] = rotationMatrixToEulerAngles(R11, R21, R31, R12, R22, R32, R13, R23, R33);
    tx_wc = -(R11 * tx_cw + R21 * ty_cw + R31 * tz_cw);
    ty_wc = -(R12 * tx_cw + R22 * ty_cw + R32 * tz_cw);
    tz_wc = -(R13 * tx_cw + R23 * ty_cw + R33 * tz_cw);
}

// update sliders/text boxes for extrinsic based on current mode
function updateExtrinsicControls() {
    if (world2camBtn.classList.contains('active')) {
        document.getElementById('rx').value = rx_wc * 180 / Math.PI;
        document.getElementById('ry').value = ry_wc * 180 / Math.PI;
        document.getElementById('rz').value = rz_wc * 180 / Math.PI;
        document.getElementById('tx').value = tx_wc;
        document.getElementById('ty').value = ty_wc;
        document.getElementById('tz').value = tz_wc;
        document.getElementById('rxText').value = rx_wc * 180 / Math.PI;
        document.getElementById('ryText').value = ry_wc * 180 / Math.PI;
        document.getElementById('rzText').value = rz_wc * 180 / Math.PI;
        document.getElementById('txText').value = tx_wc;
        document.getElementById('tyText').value = ty_wc;
        document.getElementById('tzText').value = tz_wc;
    }
    else {
        document.getElementById('rx').value = rx_cw * 180 / Math.PI;
        document.getElementById('ry').value = ry_cw * 180 / Math.PI;
        document.getElementById('rz').value = rz_cw * 180 / Math.PI;
        document.getElementById('tx').value = tx_cw;
        document.getElementById('ty').value = ty_cw;
        document.getElementById('tz').value = tz_cw;
        document.getElementById('rxText').value = rx_cw * 180 / Math.PI;
        document.getElementById('ryText').value = ry_cw * 180 / Math.PI;
        document.getElementById('rzText').value = rz_cw * 180 / Math.PI;
        document.getElementById('txText').value = tx_cw;
        document.getElementById('tyText').value = ty_cw;
        document.getElementById('tzText').value = tz_cw;
    }
}

// main function to update parameter values based on user input and trigger a redraw. It takes the id of the parameter that was changed, updates the corresponding variable, and then calls drawPoints() to update the visualization. This function is called by both the slider and text box event handlers to keep them in sync and ensure that changes to either control update the parameter and redraw the scene.
function updateParameter(id, value) {
    switch (id) {
        // Intrinsic
        case 'ps':
            break;
        case 'iw':
            updateImageDimension('iw');
            chessCanvas._undistortTable = null;
            break;
        case 'ih':
            updateImageDimension('ih');
            chessCanvas._undistortTable = null;
            break;
        case 'fx':
        case 'fy':
        case 'cx':
        case 'cy':
            chessCanvas._undistortTable = null;
            break;

        // Distortion
        case 'k1':
        case 'k2':
        case 'p1':
        case 'p2':
        case 'k3':
        case 'k4':
        case 'k5':
        case 'k6':
            chessCanvas._undistortTable = null;
            break;

        // Extrinsic (edit the appropriate set then sync)
        case 'rx':
            if (world2camBtn.classList.contains('active')) rx_wc = value * Math.PI / 180;
            else rx_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ry':
            if (world2camBtn.classList.contains('active')) ry_wc = value * Math.PI / 180;
            else ry_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'rz':
            if (world2camBtn.classList.contains('active')) rz_wc = value * Math.PI / 180;
            else rz_cw = value * Math.PI / 180;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tx':
            if (world2camBtn.classList.contains('active')) tx_wc = value;
            else tx_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ty':
            if (world2camBtn.classList.contains('active')) ty_wc = value;
            else ty_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tz':
            if (world2camBtn.classList.contains('active')) tz_wc = value;
            else tz_cw = value;
            if (world2camBtn.classList.contains('active')) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;

        // Chessboard
        case 'bc':
        case 'br':
        case 'bw':
        case 'bh':
            break;
    }

    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    } else {
        refreshCurveChart();
    }
    updateFovResults();
}

// update cx and canvas size when iw changes, keeping cx in the center by default. This function is called whenever the image width (iw) parameter is changed, and it updates the principal point cx to be at the center of the new image width by default. It also updates the maximum value of the cx slider to match the new image width, and resizes the canvas accordingly to maintain the correct aspect ratio based on the new image dimensions.
function updateImageDimension(changedId) {
    const [, iw, ih] = getIntrinsics();

    if (changedId === 'iw') {
        const cx = iw / 2;
        document.getElementById('cx').max = iw;
        document.getElementById('cx').value = cx;
        document.getElementById('cxText').value = cx;
    } else {
        const cy = ih / 2;
        document.getElementById('cy').max = ih;
        document.getElementById('cy').value = cy;
        document.getElementById('cyText').value = cy;
    }

    chessCanvas.height = ih * chessCanvas.width / iw;
}

// Intrinsics
document.getElementById('psText').addEventListener('input', function () { updateValuesFromTextBox('ps'); });
document.getElementById('iw').addEventListener('input', function () { updateValuesFromSlider('iw'); });
document.getElementById('iwText').addEventListener('input', function () { updateValuesFromTextBox('iw'); });
document.getElementById('ih').addEventListener('input', function () { updateValuesFromSlider('ih'); });
document.getElementById('ihText').addEventListener('input', function () { updateValuesFromTextBox('ih'); });
document.getElementById('fx').addEventListener('input', function () { updateValuesFromSlider('fx'); });
document.getElementById('fxText').addEventListener('input', function () { updateValuesFromTextBox('fx'); });
document.getElementById('fy').addEventListener('input', function () { updateValuesFromSlider('fy'); });
document.getElementById('fyText').addEventListener('input', function () { updateValuesFromTextBox('fy'); });
document.getElementById('cx').addEventListener('input', function () { updateValuesFromSlider('cx'); });
document.getElementById('cxText').addEventListener('input', function () { updateValuesFromTextBox('cx'); });
document.getElementById('cy').addEventListener('input', function () { updateValuesFromSlider('cy'); });
document.getElementById('cyText').addEventListener('input', function () { updateValuesFromTextBox('cy'); });

// Distortion
document.getElementById('k1').addEventListener('input', function () { updateValuesFromSlider('k1'); });
document.getElementById('k1Text').addEventListener('input', function () { updateValuesFromTextBox('k1'); });
document.getElementById('k2').addEventListener('input', function () { updateValuesFromSlider('k2'); });
document.getElementById('k2Text').addEventListener('input', function () { updateValuesFromTextBox('k2'); });
document.getElementById('p1').addEventListener('input', function () { updateValuesFromSlider('p1'); });
document.getElementById('p1Text').addEventListener('input', function () { updateValuesFromTextBox('p1'); });
document.getElementById('p2').addEventListener('input', function () { updateValuesFromSlider('p2'); });
document.getElementById('p2Text').addEventListener('input', function () { updateValuesFromTextBox('p2'); });
document.getElementById('k3').addEventListener('input', function () { updateValuesFromSlider('k3'); });
document.getElementById('k3Text').addEventListener('input', function () { updateValuesFromTextBox('k3'); });
document.getElementById('k4').addEventListener('input', function () { updateValuesFromSlider('k4'); });
document.getElementById('k4Text').addEventListener('input', function () { updateValuesFromTextBox('k4'); });
document.getElementById('k5').addEventListener('input', function () { updateValuesFromSlider('k5'); });
document.getElementById('k5Text').addEventListener('input', function () { updateValuesFromTextBox('k5'); });
document.getElementById('k6').addEventListener('input', function () { updateValuesFromSlider('k6'); });
document.getElementById('k6Text').addEventListener('input', function () { updateValuesFromTextBox('k6'); });
document.getElementById('fisheye').addEventListener('input', function () {
    chessCanvas._undistortTable = null;
    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    } else {
        refreshCurveChart();
    }
    updateFovResults();
});

// Extrinsic
document.getElementById('rx').addEventListener('input', function () { updateValuesFromSlider('rx'); });
document.getElementById('rxText').addEventListener('input', function () { updateValuesFromTextBox('rx'); });
document.getElementById('ry').addEventListener('input', function () { updateValuesFromSlider('ry'); });
document.getElementById('ryText').addEventListener('input', function () { updateValuesFromTextBox('ry'); });
document.getElementById('rz').addEventListener('input', function () { updateValuesFromSlider('rz'); });
document.getElementById('rzText').addEventListener('input', function () { updateValuesFromTextBox('rz'); });
document.getElementById('tx').addEventListener('input', function () { updateValuesFromSlider('tx'); });
document.getElementById('txText').addEventListener('input', function () { updateValuesFromTextBox('tx'); });
document.getElementById('ty').addEventListener('input', function () { updateValuesFromSlider('ty'); });
document.getElementById('tyText').addEventListener('input', function () { updateValuesFromTextBox('ty'); });
document.getElementById('tz').addEventListener('input', function () { updateValuesFromSlider('tz'); });
document.getElementById('tzText').addEventListener('input', function () { updateValuesFromTextBox('tz'); });
world2camBtn.addEventListener('click', function () {
    updateExtrinsicModeButtons('world2cam');
    updateExtrinsicControls();
});

cam2worldBtn.addEventListener('click', function () {
    updateExtrinsicModeButtons('cam2world');
    updateExtrinsicControls();
});

// Chessboard
document.getElementById('bc').addEventListener('input', function () { updateValuesFromSlider('bc'); });
document.getElementById('bcText').addEventListener('input', function () { updateValuesFromTextBox('bc'); });
document.getElementById('br').addEventListener('input', function () { updateValuesFromSlider('br'); });
document.getElementById('brText').addEventListener('input', function () { updateValuesFromTextBox('br'); });
document.getElementById('bw').addEventListener('input', function () { updateValuesFromSlider('bw'); });
document.getElementById('bwText').addEventListener('input', function () { updateValuesFromTextBox('bw'); });
document.getElementById('bh').addEventListener('input', function () { updateValuesFromSlider('bh'); });
document.getElementById('bhText').addEventListener('input', function () { updateValuesFromTextBox('bh'); });
function switchChessboardOrigin(targetMode) {
    const isCenterNow = centerAtCTBtn.classList.contains('active');
    const targetCenter = targetMode === 'center';
    if (isCenterNow === targetCenter) {
        return;
    }

    const [bc, br, bw, bh] = getChessboardSettings();
    const previousCenter = isCenterNow;
    // when toggling center, we want to keep the board visually fixed in place. To do this, we compute the world-space translation that corresponds to the shift in board position, rotate it into camera space using the current world->camera rotation, and apply the opposite translation to the camera so that the board appears stationary. This allows us to toggle between a centered and non-centered board without it jumping around in the view.
    let halfbw = ((bc - 1) / 2) * bw;
    let halfbh = ((br - 1) / 2) * bh;
    let sign = previousCenter ? 1 : -1; // current before toggle
    let delta = [sign * halfbw, sign * halfbh, 0];

    // use world->camera rotation
    let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    let tdx = -(R11 * delta[0] + R12 * delta[1] + R13 * delta[2]);
    let tdy = -(R21 * delta[0] + R22 * delta[1] + R23 * delta[2]);
    let tdz = -(R31 * delta[0] + R32 * delta[1] + R33 * delta[2]);
    tx_wc += tdx;
    ty_wc += tdy;
    tz_wc += tdz;

    // sync and refresh UI
    updateChessboardOriginTabs(targetMode);
    syncExtrinsicsFromWorldToCamera();
    updateExtrinsicControls();
    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    }
}

centerAtTLBtn.addEventListener('click', function () {
    switchChessboardOrigin('tl');
});

centerAtCTBtn.addEventListener('click', function () {
    switchChessboardOrigin('center');
});
document.getElementById('showSquares').addEventListener('input', function () {
    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    }
});
document.getElementById('showCircles').addEventListener('input', function () {
    if (viewChessboardBtn.classList.contains('active')) {
        renderChessboard();
    }
});

viewChessboardBtn.addEventListener('click', function () {
    toggleChessUI(true);
    toggleCurveUI(false);
    renderChessboard();
    updateFovResults();
});

viewCurveBtn.addEventListener('click', function () {
    toggleChessUI(false);
    toggleCurveUI(true);
    refreshCurveChart();
    updateFovResults();
});

bindCurveAxisControls('x');
bindCurveAxisControls('y');
curveDirectionAngleSlider.addEventListener('input', function () {
    curveDirectionAngleText.value = this.value;
    refreshCurveChart();
});
curveDirectionAngleText.addEventListener('input', function () {
    setCurveDirectionAngle(parseFloat(this.value));
});
curveDirectionPresetButtons.forEach(button => {
    button.addEventListener('click', function () {
        setCurveDirectionFromPreset(this.dataset.curveDirectionTarget);
    });
});

// Reset
document.getElementById('reset').addEventListener('click', () => location.reload());

// initial setup
initCurveChart();
toggleChessUI(true);
toggleCurveUI(false);
updateExtrinsicModeButtons('world2cam');
updateChessboardOriginTabs('center');
syncCurveAxisUnitVisibility('x');
syncCurveAxisUnitVisibility('y');
setCurveDirectionAngle(parseFloat(curveDirectionAngleSlider.value));

// initial draw
renderChessboard();
updateFovResults();
const chessCanvas = document.getElementById('canvas');      // main canvas for rendering the chessboard and corners, using the undistortion table to determine pixel colors for the chessboard squares and projecting 3D corner points based on current extrinsic parameters. This canvas is shown when "Chessboard" view is active.
const chessCtx = chessCanvas.getContext('2d');
const curveCanvas = document.getElementById('curveCanvas'); // canvas for rendering the distortion curve using Chart.js, which plots the relationship between the incoming ray angle/slope and the reflected ray angle/slope based on the current distortion parameters. This canvas is shown when "Distortion Curve" view is active. It is initialized lazily when switching to curve view for the first time, since rendering the curve can be computationally expensive and we want to avoid doing it unnecessarily if the user only wants to see the chessboard.
const curveCtx = curveCanvas.getContext('2d');

let curveChart = null;  // Chart.js instance for the distortion curve, initialized lazily when switching to curve view for the first time
let undistortTable = null;

const viewChessboardBtn = document.getElementById('viewChessboard');
const viewCurveBtn = document.getElementById('viewCurve');
const curveAxisOptions = document.getElementById('curveAxisOptions');
const curveXUnitGroup = document.getElementById('curveXUnitGroup');
const curveYUnitGroup = document.getElementById('curveYUnitGroup');
const hFovLabel = document.getElementById('hFovLabel');
const vFovLabel = document.getElementById('vFovLabel');
const dFovLabel = document.getElementById('dFovLabel');
const curveXTypeOptions = document.querySelectorAll('input[name="curveXType"]');
const curveXUnitOptions = document.querySelectorAll('input[name="curveXUnit"]');
const curveYTypeOptions = document.querySelectorAll('input[name="curveYType"]');
const curveYUnitOptions = document.querySelectorAll('input[name="curveYUnit"]');

// Initial Parameters
let canvas_w = 640;
let iw = 1920, ih = 1080, fx = 1000, fy = 1000, cx = 960, cy = 540;
let k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0, fisheye = false;
let bc = 12, br = 9, bw = 100, bh = 100, center = true, showSquares = false, showCircles = true;
let rx_wc = 0, ry_wc = 0, rz_wc = 0, tx_wc = 0, ty_wc = 0, tz_wc = 1000;
let rx_cw = 0, ry_cw = 0, rz_cw = 0, tx_cw = 0, ty_cw = 0, tz_cw = -1000;
let inverse = false;
// active view target: chessboard canvas or distortion curve chart canvas
let viewMode = 'chessboard';
let curveXType = 'angle';
let curveXUnit = 'deg';
let curveYType = 'angle';
let curveYUnit = 'deg';
let objp = [];

function updateViewControls() {
    if (viewMode === 'chessboard') {
        viewChessboardBtn.classList.add('active');
        viewCurveBtn.classList.remove('active');
        curveAxisOptions.classList.add('hidden');
        chessCanvas.classList.remove('hidden');
        curveCanvas.classList.add('hidden');
        chessCanvas.style.display = 'block';
        curveCanvas.style.display = 'none';
    } else {
        viewCurveBtn.classList.add('active');
        viewChessboardBtn.classList.remove('active');
        curveAxisOptions.classList.remove('hidden');
        curveCanvas.classList.remove('hidden');
        chessCanvas.classList.add('hidden');
        curveCanvas.style.display = 'block';
        chessCanvas.style.display = 'none';
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
function applyDistortion(xc, yc, zc) {
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

function projectPoint(p3d) {
    // compute rotation matrix once and reuse (world->camera case)
    let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);

    // Apply rotation & translation (world->camera)
    let [xw, yw, zw] = p3d;
    let xc = R11 * xw + R12 * yw + R13 * zw + tx_wc;
    let yc = R21 * xw + R22 * yw + R23 * zw + ty_wc;
    let zc = R31 * xw + R32 * yw + R33 * zw + tz_wc;

    // normalize and apply distortion
    let [xp, yp] = applyDistortion(xc, yc, zc);

    // apply intrinsics
    let u = fx * xp + cx;
    let v = fy * yp + cy;

    // scale to canvas size (this allows the intrinsic parameters to be specified in terms of an arbitrary image size, independent of the canvas display size)
    u = u * chessCanvas.width / iw;
    v = v * chessCanvas.height / ih;
    return [u, v, zc];
}

// iteratively undistort normalized coordinates by minimizing the difference between the input distorted coordinates and the output of applyDistortion. This is necessary because the distortion models are not easily invertible, especially for the fisheye model. The function starts with the distorted coordinates as an initial guess and iteratively refines it until convergence or a maximum number of iterations is reached.
function undistortNormalized(xDist, yDist, options = {}) {
    const maxIter = options.maxIter ?? 30;
    let lambda = options.lambda0 ?? 1e-3;
    const tol = options.tol ?? 1e-12;
    const costTol = options.costTol ?? 1e-12;
    const maxLambda = 1e16;
    const r_eps = 1e-12;

    // initial guess
    let x = xDist, y = yDist;
    let out = applyDistortion(x, y, 1);
    let r0 = out[0] - xDist, r1 = out[1] - yDist;
    let cost = r0 * r0 + r1 * r1;

    for (let iter = 0; iter < maxIter; ++iter) {
        // Jacobian J = d(xp,yp)/d(x,y)
        let J00, J01, J10, J11;

        if (fisheye) {
            const r = Math.hypot(x, y);
            if (r < r_eps) {
                J00 = 1; J01 = 0; J10 = 0; J11 = 1;
            } else {
                const t = Math.atan(r);
                const t2 = t * t, t3 = t2 * t, t4 = t2 * t2, t5 = t3 * t2, t6 = t3 * t3, t7 = t4 * t3, t8 = t4 * t4, t9 = t5 * t4;
                const fd = t + k1 * t3 + k2 * t5 + k3 * t7 + k4 * t9;
                const dfd_dt = 1 + 3 * k1 * t2 + 5 * k2 * t4 + 7 * k3 * t6 + 9 * k4 * t8;
                const dtdr = 1.0 / (1 + r * r);
                const dfd_dr = dfd_dt * dtdr;
                const S = fd / r;
                const dS_dr = (dfd_dr * r - fd) / (r * r);
                const x_r = x / r, y_r = y / r;
                J00 = S + (x * x_r) * dS_dr;
                J01 = x * (dS_dr * y_r);
                J10 = y * (dS_dr * x_r);
                J11 = S + (y * y_r) * dS_dr;
            }
        } else {
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
        }

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
        out = applyDistortion(xT, yT, 1);
        const r0t = out[0] - xDist, r1t = out[1] - yDist;
        const costT = r0t * r0t + r1t * r1t;

        if (costT < cost) {
            x = xT; y = yT; r0 = r0t; r1 = r1t;
            const diff = cost - costT;
            cost = costT;
            lambda = Math.max(lambda * 0.1, 1e-16);
            if (dx * dx + dy * dy < tol) break;
            if (diff < costTol) break;
        } else {
            lambda = Math.min(lambda * 10, maxLambda);
            if (lambda >= maxLambda) break;
        }
    }

    return [x, y];
}

// precompute the undistortion table for each pixel in the canvas. This allows us to quickly look up the corresponding undistorted ray direction for each pixel when rendering the chessboard squares, without having to run the iterative undistortion process for every pixel on every frame. The table is updated whenever the intrinsics or distortion parameters change, since those affect the mapping from distorted image coordinates to undistorted ray directions.
function updateUndistortTable() {
    let width = chessCanvas.width, height = chessCanvas.height;
    let size = width * height;
    let dx = new Float32Array(size);
    let dy = new Float32Array(size);
    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            let ud = u * iw / width;
            let vd = v * ih / height;
            let xDist = (ud - cx) / fx;
            let yDist = (vd - cy) / fy;
            let [xu, yu] = undistortNormalized(xDist, yDist);
            let idx = v * width + u;
            dx[idx] = xu;
            dy[idx] = yu;
        }
    }
    undistortTable = { dx, dy, width, height };
}

// render the chessboard and corners based on current parameters. If "showSquares" is enabled, it uses the undistortion table to determine the color of each pixel by raycasting from the camera through the distorted image plane into the world to see what color it hits on the chessboard. If "showCircles" is enabled, it projects the 3D corner points and draws filled circles at their locations, colored red if they are in front of the camera and blue if they are behind, which helps visualize how the extrinsic parameters affect the projection of points in space.
function renderChessboard() {
    chessCtx.clearRect(0, 0, chessCanvas.width, chessCanvas.height);

    if (showSquares) {
        let width = chessCanvas.width, height = chessCanvas.height;
        let img = chessCtx.getImageData(0, 0, width, height);
        let data = img.data;

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
                let dx = undistortTable.dx[idx];
                let dy = undistortTable.dy[idx];
                let dz = 1;

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
        objp.forEach(p3d => {
            let [u, v, zc] = projectPoint(p3d);
            chessCtx.fillStyle = zc > 0 ? "red" : "blue";
            chessCtx.beginPath();
            chessCtx.arc(u, v, 3, 0, 2 * Math.PI);
            chessCtx.fill();
        });
    }
}

function applyUnitOptionVisibility(optionList, allowedValues) {
    optionList.forEach(option => {
        const label = option.closest('label');
        const show = allowedValues.includes(option.value);
        if (label) {
            label.classList.toggle('hidden', !show);
            label.classList.toggle('disabled-option', !show);
        }
        option.disabled = !show;
        if (!show && option.checked) {
            option.checked = false;
        }
    });
}

function setUnitGroupDisabled(optionList, disabled) {
    optionList.forEach(option => {
        const label = option.closest('label');
        if (label) {
            label.classList.toggle('disabled-option', disabled);
        }
        option.disabled = disabled;
    });
}

function updateFovDisplay() {
    const toDeg = 180 / Math.PI;
    const nearestU = Math.abs(cx - 0) <= Math.abs(iw - cx) ? 0 : iw;
    const nearestV = Math.abs(cy - 0) <= Math.abs(ih - cy) ? 0 : ih;

    const corners = [[0, 0], [iw, 0], [0, ih], [iw, ih]];
    let nearestCorner = corners[0];
    let nearestCornerDist2 = Number.POSITIVE_INFINITY;
    corners.forEach(corner => {
        const du = corner[0] - cx;
        const dv = corner[1] - cy;
        const d2 = du * du + dv * dv;
        if (d2 < nearestCornerDist2) {
            nearestCornerDist2 = d2;
            nearestCorner = corner;
        }
    });

    const [hx, hy] = undistortNormalized((nearestU - cx) / fx, (cy - cy) / fy);
    const [vx, vy] = undistortNormalized((cx - cx) / fx, (nearestV - cy) / fy);
    const [dx, dy] = undistortNormalized((nearestCorner[0] - cx) / fx, (nearestCorner[1] - cy) / fy);

    const hFov = 2 * Math.atan(Math.abs(hx)) * toDeg;
    const vFov = 2 * Math.atan(Math.abs(vy)) * toDeg;
    const dFov = 2 * Math.atan(Math.hypot(dx, dy)) * toDeg;
    hFovLabel.textContent = `hFOV: ${hFov.toFixed(2)}°`;
    vFovLabel.textContent = `vFOV: ${vFov.toFixed(2)}°`;
    dFovLabel.textContent = `dFOV: ${dFov.toFixed(2)}°`;
}

function syncCurveUnitVisibility() {
    if (curveXType === 'angle') {
        curveXUnitGroup.classList.remove('hidden');
        applyUnitOptionVisibility(curveXUnitOptions, ['deg', 'rad']);
        if (curveXUnit !== 'deg' && curveXUnit !== 'rad') {
            curveXUnit = 'deg';
            document.querySelector('input[name="curveXUnit"][value="deg"]').checked = true;
        }
    } else {
        curveXUnitGroup.classList.add('hidden');
        setUnitGroupDisabled(curveXUnitOptions, true);
    }

    if (curveYType === 'angle') {
        curveYUnitGroup.classList.remove('hidden');
        applyUnitOptionVisibility(curveYUnitOptions, ['deg', 'rad']);
        if (curveYUnit !== 'deg' && curveYUnit !== 'rad') {
            curveYUnit = 'deg';
            document.querySelector('input[name="curveYUnit"][value="deg"]').checked = true;
        }
    } else if (curveYType === 'height') {
        curveYUnitGroup.classList.remove('hidden');
        applyUnitOptionVisibility(curveYUnitOptions, ['pixel', 'um', 'mm', 'cm', 'm']);
        if (!['pixel', 'um', 'mm', 'cm', 'm'].includes(curveYUnit)) {
            curveYUnit = 'pixel';
            document.querySelector('input[name="curveYUnit"][value="pixel"]').checked = true;
        }
    } else {
        curveYUnitGroup.classList.add('hidden');
        setUnitGroupDisabled(curveYUnitOptions, true);
    }
}

function outputSlopeToYAxisValue(outputSlope) {
    if (curveYType === 'angle') {
        if (curveYUnit === 'rad') {
            return Math.atan(outputSlope);
        }
        return Math.atan(outputSlope) * 180 / Math.PI;
    }

    if (curveYType === 'height') {
        switch (curveYUnit) {
            case 'pixel':
                return fy * outputSlope;
            case 'um':
                return outputSlope * 1e6;
            case 'mm':
                return outputSlope * 1e3;
            case 'cm':
                return outputSlope * 1e2;
            case 'm':
            default:
                return outputSlope;
        }
    }

    return outputSlope;
}

function getXAxisLabel() {
    if (curveXType === 'angle') {
        return curveXUnit === 'rad' ? 'incoming ray angle (rad)' : 'incoming ray angle (deg)';
    }
    return 'incoming ray slope (tanθ)';
}

function getYAxisLabel() {
    if (curveYType === 'angle') {
        return curveYUnit === 'rad' ? 'reflected ray angle (rad)' : 'reflected ray angle (deg)';
    }
    if (curveYType === 'height') {
        return `image height (${curveYUnit})`;
    }
    return 'reflected ray slope (tanθ)';
}

function buildCurveSeriesData() {
    const samples = 100;
    const corners = [[0, 0], [iw, 0], [0, ih], [iw, ih]];
    let farthestCorner = corners[0];
    let farthestDist2 = Number.NEGATIVE_INFINITY;
    corners.forEach(corner => {
        const du = corner[0] - cx;
        const dv = corner[1] - cy;
        const d2 = du * du + dv * dv;
        if (d2 > farthestDist2) {
            farthestDist2 = d2;
            farthestCorner = corner;
        }
    });

    const xValues = [];
    const yValues = [];
    let xMin = Number.POSITIVE_INFINITY;
    let xMax = Number.NEGATIVE_INFINITY;
    let yMin = Number.POSITIVE_INFINITY;
    let yMax = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < samples; i++) {
        const t = samples === 1 ? 0 : i / (samples - 1);
        const u = cx + (farthestCorner[0] - cx) * t;
        const v = cy + (farthestCorner[1] - cy) * t;

        const xDist = (u - cx) / fx;
        const yDist = (v - cy) / fy;
        const [xu, yu] = undistortNormalized(xDist, yDist);
        const incomingSlope = Math.hypot(xu, yu);
        const [xd, yd] = applyDistortion(xu, yu, 1);
        const outputSlope = Math.hypot(xd, yd);

        let xValue;
        if (curveXType === 'angle') {
            const angleRad = Math.atan(incomingSlope);
            xValue = curveXUnit === 'rad' ? angleRad : angleRad * 180 / Math.PI;
        } else {
            xValue = incomingSlope;
        }

        const yValue = outputSlopeToYAxisValue(outputSlope);

        if (isFinite(xValue) && isFinite(yValue)) {
            xValues.push(xValue);
            yValues.push(yValue);
            xMin = Math.min(xMin, xValue);
            xMax = Math.max(xMax, xValue);
            yMin = Math.min(yMin, yValue);
            yMax = Math.max(yMax, yValue);
        }
    }

    return { xValues, yValues, xMin, xMax, yMin, yMax };
}

function ensureCurveChart() {
    if (curveChart) return;
    curveChart = new Chart(curveCtx, {
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
                label: 'Distortion',
                data: [],
                borderColor: '#0b63f6',
                borderWidth: 2,
                pointRadius: 0,
                tension: 0
            }]
        },
        options: {
            animation: false,
            responsive: false,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    type: 'linear',
                    title: {
                        display: true,
                        text: getXAxisLabel(),
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
                        text: getYAxisLabel(),
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

function refreshCurveChart() {
    ensureCurveChart();
    const { xValues, yValues, xMin: rawXMin, xMax: rawXMax, yMin: rawYMin, yMax: rawYMax } = buildCurveSeriesData();

    let xMin = rawXMin;
    let xMax = rawXMax;
    let yMin = rawYMin;
    let yMax = rawYMax;

    if (!isFinite(xMin) || !isFinite(xMax) || xMin === xMax) {
        xMin = 0;
        xMax = 1;
    }

    if (!isFinite(yMin) || !isFinite(yMax) || yMin === yMax) {
        yMin = 0;
        yMax = 1;
    }

    const xPad = (xMax - xMin) * 0.05 || 0.05;
    xMin -= xPad;
    xMax += xPad;
    const yPad = (yMax - yMin) * 0.1 || 0.1;
    yMin -= yPad;
    yMax += yPad;

    const points = xValues.map((x, index) => ({ x, y: yValues[index] }));

    curveChart.data.datasets[0].data = points;
    curveChart.options.scales.x.min = xMin;
    curveChart.options.scales.x.max = xMax;
    curveChart.options.scales.y.min = yMin;
    curveChart.options.scales.y.max = yMax;
    curveChart.options.scales.x.title.text = getXAxisLabel();
    curveChart.options.scales.y.title.text = getYAxisLabel();
    curveChart.update('none');
}

// helper function to update parameter values and trigger a redraw when a slider or text box is changed. It takes the id of the parameter that was changed, updates the corresponding variable, and then calls drawPoints() to update the visualization. This function is called by both the slider and text box event handlers to keep them in sync and ensure that changes to either control update the parameter and redraw the scene.
function updateValuesFromSlider(id) {
    const slider = document.getElementById(id);
    const textBox = document.getElementById(id + "Text");
    textBox.value = slider.value;
    updateParameter(id, parseFloat(slider.value));
}

// similar to updateValuesFromSlider but triggered by changes to the text boxes. It updates the corresponding slider to keep them in sync, and then calls updateParameter() to update the parameter value and redraw the scene. This allows the user to either drag the slider or enter a specific value in the text box, and both controls will reflect the change while updating the visualization accordingly.
function updateValuesFromTextBox(id) {
    const textBox = document.getElementById(id + "Text");
    const slider = document.getElementById(id);
    slider.value = textBox.value;
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
    const toDeg = r => r * 180 / Math.PI;
    if (!inverse) {
        document.getElementById('rx').value = toDeg(rx_wc);
        document.getElementById('ry').value = toDeg(ry_wc);
        document.getElementById('rz').value = toDeg(rz_wc);
        document.getElementById('tx').value = tx_wc;
        document.getElementById('ty').value = ty_wc;
        document.getElementById('tz').value = tz_wc;
        document.getElementById('rxText').value = toDeg(rx_wc);
        document.getElementById('ryText').value = toDeg(ry_wc);
        document.getElementById('rzText').value = toDeg(rz_wc);
        document.getElementById('txText').value = tx_wc;
        document.getElementById('tyText').value = ty_wc;
        document.getElementById('tzText').value = tz_wc;
    }
    else {
        document.getElementById('rx').value = toDeg(rx_cw);
        document.getElementById('ry').value = toDeg(ry_cw);
        document.getElementById('rz').value = toDeg(rz_cw);
        document.getElementById('tx').value = tx_cw;
        document.getElementById('ty').value = ty_cw;
        document.getElementById('tz').value = tz_cw;
        document.getElementById('rxText').value = toDeg(rx_cw);
        document.getElementById('ryText').value = toDeg(ry_cw);
        document.getElementById('rzText').value = toDeg(rz_cw);
        document.getElementById('txText').value = tx_cw;
        document.getElementById('tyText').value = ty_cw;
        document.getElementById('tzText').value = tz_cw;
    }
}

// main function to update parameter values based on user input and trigger a redraw. It takes the id of the parameter that was changed, updates the corresponding variable, and then calls drawPoints() to update the visualization. This function is called by both the slider and text box event handlers to keep them in sync and ensure that changes to either control update the parameter and redraw the scene.
function updateParameter(id, value) {
    switch (id) {
        // Intrinsic
        case 'iw': iw = value; update_iw(); break;
        case 'ih': ih = value; update_ih(); break;
        case 'fx': fx = value; break;
        case 'fy': fy = value; break;
        case 'cx': cx = value; break;
        case 'cy': cy = value; break;

        // Distortion
        case 'k1': k1 = value; break;
        case 'k2': k2 = value; break;
        case 'p1': p1 = value; break;
        case 'p2': p2 = value; break;
        case 'k3': k3 = value; break;
        case 'k4': k4 = value; break;
        case 'k5': k5 = value; break;
        case 'k6': k6 = value; break;

        // Extrinsic (edit the appropriate set then sync)
        case 'rx':
            if (!inverse) rx_wc = value * Math.PI / 180;
            else rx_cw = value * Math.PI / 180;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ry':
            if (!inverse) ry_wc = value * Math.PI / 180;
            else ry_cw = value * Math.PI / 180;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'rz':
            if (!inverse) rz_wc = value * Math.PI / 180;
            else rz_cw = value * Math.PI / 180;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tx':
            if (!inverse) tx_wc = value;
            else tx_cw = value;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'ty':
            if (!inverse) ty_wc = value;
            else ty_cw = value;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;
        case 'tz':
            if (!inverse) tz_wc = value;
            else tz_cw = value;
            if (!inverse) syncExtrinsicsFromWorldToCamera();
            else syncExtrinsicsFromCameraToWorld();
            break;

        // Chessboard
        case 'bc': bc = value; update_objp(); break;
        case 'br': br = value; update_objp(); break;
        case 'bw': bw = value; update_objp(); break;
        case 'bh': bh = value; update_objp(); break;
    }

    // parameters that affect undistortion should rebuild the table
    const rebuildIds = ['iw', 'ih', 'fx', 'fy', 'cx', 'cy', 'k1', 'k2', 'k3', 'k4', 'k5', 'k6', 'p1', 'p2'];
    if (rebuildIds.includes(id) && showSquares) { updateUndistortTable(); }
    updateFovDisplay();
    if (viewMode === 'chessboard') {
        renderChessboard();
    } else {
        refreshCurveChart();
    }
}

// update cx and canvas size when iw changes, keeping cx in the center by default. This function is called whenever the image width (iw) parameter is changed, and it updates the principal point cx to be at the center of the new image width by default. It also updates the maximum value of the cx slider to match the new image width, and resizes the canvas accordingly to maintain the correct aspect ratio based on the new image dimensions.
function update_iw() {
    cx = iw / 2;
    document.getElementById('cx').value = cx;
    document.getElementById('cxText').value = cx;
    document.getElementById('cx').max = iw;

    const chessboardWidth = canvas_w;
    const chessboardHeight = ih * canvas_w / iw;
    chessCanvas.width = iw * canvas_w / iw;
    chessCanvas.height = chessboardHeight;

    if (viewMode === 'curve') {
        const curveCanvasHeight = canvas_w * 3 / 4;
        curveCanvas.width = canvas_w;
        curveCanvas.height = curveCanvasHeight;
        curveCanvas.style.width = `${canvas_w}px`;
        curveCanvas.style.height = `${curveCanvasHeight}px`;
        if (curveChart) {
            curveChart.resize();
        }
    }
}

// update cy and canvas size when ih changes, keeping cy in the center by default. This function is called whenever the image height (ih) parameter is changed, and it updates the principal point cy to be at the center of the new image height by default. It also updates the maximum value of the cy slider to match the new image height, and resizes the canvas accordingly to maintain the correct aspect ratio based on the new image dimensions.
function update_ih() {
    cy = ih / 2;
    document.getElementById('cy').value = cy;
    document.getElementById('cyText').value = cy;
    document.getElementById('cy').max = ih;

    chessCanvas.width = canvas_w;
    chessCanvas.height = ih * canvas_w / iw;

    if (viewMode === 'curve') {
        const curveCanvasHeight = canvas_w * 3 / 4;
        curveCanvas.width = canvas_w;
        curveCanvas.height = curveCanvasHeight;
        curveCanvas.style.width = `${canvas_w}px`;
        curveCanvas.style.height = `${curveCanvasHeight}px`;
        if (curveChart) {
            curveChart.resize();
        }
    }
}

// recompute the 3D coordinates of the chessboard corners based on the current board parameters (number of corners, square size, and centering). This function is called whenever any of the chessboard parameters (number of columns, number of rows, square width, square height) are changed, and it updates the objp array with the new 3D coordinates of the corners. The corners are arranged in a grid pattern based on the specified number of columns and rows, with spacing determined by the square size parameters. If "center" is enabled, the grid is centered around the origin; otherwise, it starts from (0,0).
function update_objp() {
    objp = [];
    let x_min = center ? -(bc - 1) / 2 : 0;
    let x_max = center ? bc / 2 : bc;
    let y_min = center ? -(br - 1) / 2 : 0;
    let y_max = center ? br / 2 : br;
    for (let y = y_min; y < y_max; y++) {
        for (let x = x_min; x < x_max; x++) {
            objp.push([x * bw, y * bh, 0]);
        }
    }
}

// Intrinsics
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
    fisheye = this.checked;
    if (showSquares) updateUndistortTable();
    updateFovDisplay();
    if (viewMode === 'chessboard') {
        renderChessboard();
    } else {
        refreshCurveChart();
    }
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
document.getElementById('inverse').addEventListener('input', function () {
    inverse = this.checked;
    updateExtrinsicControls();
    if (viewMode === 'chessboard') {
        renderChessboard();
    }
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
document.getElementById('center').addEventListener('input', function () {
    // when toggling center, we want to keep the board visually fixed in place. To do this, we compute the world-space translation that corresponds to the shift in board position, rotate it into camera space using the current world->camera rotation, and apply the opposite translation to the camera so that the board appears stationary. This allows us to toggle between a centered and non-centered board without it jumping around in the view.
    let halfbw = ((bc - 1) / 2) * bw;
    let halfbh = ((br - 1) / 2) * bh;
    let sign = center ? 1 : -1; // current before toggle
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
    syncExtrinsicsFromWorldToCamera();
    updateExtrinsicControls();

    center = this.checked;
    update_objp();
    if (viewMode === 'chessboard') {
        renderChessboard();
    }
});
document.getElementById('showSquares').addEventListener('input', function () {
    showSquares = this.checked;
    if (showSquares) updateUndistortTable();
    if (viewMode === 'chessboard') {
        renderChessboard();
    }
});
document.getElementById('showCircles').addEventListener('input', function () {
    showCircles = this.checked;
    if (viewMode === 'chessboard') {
        renderChessboard();
    }
});

viewChessboardBtn.addEventListener('click', function () {
    viewMode = 'chessboard';
    renderChessboard();
    updateViewControls();
});

viewCurveBtn.addEventListener('click', function () {
    viewMode = 'curve';
    refreshCurveChart();
    updateViewControls();
});

curveXTypeOptions.forEach(option => {
    option.addEventListener('input', function () {
        curveXType = this.value;
        syncCurveUnitVisibility();
        refreshCurveChart();
    });
});

curveXUnitOptions.forEach(option => {
    option.addEventListener('input', function () {
        curveXUnit = this.value;
        refreshCurveChart();
    });
});

curveYTypeOptions.forEach(option => {
    option.addEventListener('input', function () {
        curveYType = this.value;
        syncCurveUnitVisibility();
        refreshCurveChart();
    });
});

curveYUnitOptions.forEach(option => {
    option.addEventListener('input', function () {
        curveYUnit = this.value;
        refreshCurveChart();
    });
});

// Reset
document.getElementById('reset').addEventListener('click', () => location.reload());

// initialize 3D corner points of the chessboard based on initial parameters
update_objp();
update_iw();
update_ih();
const initialCurveCanvasHeight = canvas_w * 3 / 4;
curveCanvas.width = canvas_w;
curveCanvas.height = initialCurveCanvasHeight;
curveCanvas.style.width = `${canvas_w}px`;
curveCanvas.style.height = `${initialCurveCanvasHeight}px`;

// undistortion lookup table when showing squares
if (showSquares) updateUndistortTable();

updateViewControls();
syncCurveUnitVisibility();
updateFovDisplay();

// initial draw
renderChessboard();
// Core math and render logic (non-UI-specific)
const chessCanvas = document.getElementById('canvas');
const chessCtx = chessCanvas.getContext('2d');
chessCanvas._undistortTable = null;

const curveCanvas = document.getElementById('curveCanvas');
const curveCtx = curveCanvas.getContext('2d');

const directionCanvas = document.getElementById('directionCanvas');
const directionCtx = directionCanvas.getContext('2d');

const DIRECTION_CANVAS_MAX_WIDTH = 220;
const DIRECTION_CANVAS_MAX_HEIGHT = 135;
const CHESSBOARD_MASK_MAX_DIMENSION = 2048;

// Extrinsics state (global)
let rx_wc = 0, ry_wc = 0, rz_wc = 0, tx_wc = 0, ty_wc = 0, tz_wc = 1200;
let rx_cw = 0, ry_cw = 0, rz_cw = 0, tx_cw = 0, ty_cw = 0, tz_cw = -1200;

function getNumericControlValue(id) {
    const textControl = document.getElementById(`${id}Text`);
    if (textControl) {
        const textValue = parseFloat(textControl.value);
        if (Number.isFinite(textValue)) {
            return textValue;
        }
    }

    const control = document.getElementById(id);
    if (!control) {
        return NaN;
    }

    const controlValue = parseFloat(control.value);
    return Number.isFinite(controlValue) ? controlValue : NaN;
}

function getIntrinsics() {
    return [
        getNumericControlValue('ps'),
        getNumericControlValue('iw'),
        getNumericControlValue('ih'),
        getNumericControlValue('fx'),
        getNumericControlValue('fy'),
        getNumericControlValue('cx'),
        getNumericControlValue('cy')
    ];
}

function getDistortion() {
    return [
        getNumericControlValue('k1'),
        getNumericControlValue('k2'),
        getNumericControlValue('p1'),
        getNumericControlValue('p2'),
        getNumericControlValue('k3'),
        getNumericControlValue('k4'),
        getNumericControlValue('k5'),
        getNumericControlValue('k6'),
        document.getElementById('fisheye').checked
    ];
}

function getChessboardViewCameraModel() {
    const intrinsics = tableTab?.classList.contains('active') && typeof getTableConversionIntrinsics === 'function'
        ? getTableConversionIntrinsics()
        : getIntrinsics();
    const distortion = getDistortion();
    const outputRadio = document.getElementById('chessOutputIntrinsic');
    const useOutput = !!outputRadio?.checked;
    const refitResult = curveCanvas?._curveSamples?.refitResult;

    if (useOutput && refitResult?.params?.length >= 8) {
        return {
            intrinsics,
            distortion: [
                refitResult.params[0], refitResult.params[1], refitResult.params[2], refitResult.params[3],
                refitResult.params[4], refitResult.params[5], refitResult.params[6], refitResult.params[7],
                !!refitResult.fisheye
            ]
        };
    }

    return { intrinsics, distortion };
}

function getChessboardSettings() {
    return [
        getNumericControlValue('bc'),
        getNumericControlValue('br'),
        getNumericControlValue('bw'),
        getNumericControlValue('bh'),
        document.getElementById('centerAtCenter').classList.contains('active'),
        document.getElementById('showSquares').checked,
        document.getElementById('showCircles').checked,
        document.getElementById('extraWhitePadding')?.checked ?? false
    ];
}

function getChessboardCornerRanges(bc, br, center) {
    return {
        xMin: center ? -(bc - 1) / 2 : 0,
        xMax: center ? bc / 2 : bc,
        yMin: center ? -(br - 1) / 2 : 0,
        yMax: center ? br / 2 : br
    };
}

function getChessboardMaskCacheKey(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, bc, br, bw, bh, center, extraWhitePadding) {
    return [
        chessCanvas.width, chessCanvas.height,
        iw, ih, fx, fy, cx, cy,
        k1, k2, p1, p2, k3, k4, k5, k6, fisheye ? 1 : 0,
        rx_cw, ry_cw, rz_cw, tx_cw, ty_cw, tz_cw,
        bc, br, bw, bh, center ? 1 : 0, extraWhitePadding ? 1 : 0
    ].map(value => Number.isFinite(value) ? Number(value).toFixed(6) : String(value)).join('|');
}

function getChessboardBoundaryCornerWorldPoints() {
    const [bc, br, bw, bh, center] = getChessboardSettings();
    const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);
    const xValues = [];
    const yValues = [];

    for (let x = xMin; x < xMax; x += 1) xValues.push(x);
    for (let y = yMin; y < yMax; y += 1) yValues.push(y);

    if (xValues.length === 0 || yValues.length === 0) return [];

    const boundaryPoints = [];
    const topY = yValues[0] * bh;
    const bottomY = yValues[yValues.length - 1] * bh;
    const leftX = xValues[0] * bw;
    const rightX = xValues[xValues.length - 1] * bw;

    for (const x of xValues) boundaryPoints.push([x * bw, topY, 0]);
    for (let i = 1; i < yValues.length; i++) boundaryPoints.push([rightX, yValues[i] * bh, 0]);
    if (yValues.length > 1) {
        for (let i = xValues.length - 2; i >= 0; i--) boundaryPoints.push([xValues[i] * bw, bottomY, 0]);
    }
    if (xValues.length > 1) {
        for (let i = yValues.length - 2; i > 0; i--) boundaryPoints.push([leftX, yValues[i] * bh, 0]);
    }

    return boundaryPoints;
}

function getProjectedChessboardContourPoints() {
    const { intrinsics, distortion } = getChessboardViewCameraModel();
    const [, , , fx, fy, cx, cy] = intrinsics;
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = distortion;
    const contourPoints = [];

    for (const point3d of getChessboardBoundaryCornerWorldPoints()) {
        const [u, v, zc] = projectPointToImage(point3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
        if (!isFinite(u) || !isFinite(v) || zc <= 0) {
            return [];
        }
        contourPoints.push([u, v]);
    }

    return contourPoints;
}

function calculateChessboardMaskCoverage() {
    const { intrinsics, distortion } = getChessboardViewCameraModel();
    const [, iw, ih, fx, fy, cx, cy] = intrinsics;
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = distortion;
    const [bc, br, bw, bh, center, , , extraWhitePadding] = getChessboardSettings();

    if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0 || !isFinite(fx) || !isFinite(fy)) {
        return { occupiedPixelCount: 0, totalPixels: 0, coverageRatio: NaN };
    }

    const cacheKey = getChessboardMaskCacheKey(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, bc, br, bw, bh, center, extraWhitePadding);
    if (chessCanvas._maskStatsCache?.key === cacheKey) {
        return chessCanvas._maskStatsCache.value;
    }

    const imageWidth = Math.max(1, Math.round(iw));
    const imageHeight = Math.max(1, Math.round(ih));
    const totalPixels = imageWidth * imageHeight;
    const maskScale = Math.min(1, CHESSBOARD_MASK_MAX_DIMENSION / Math.max(imageWidth, imageHeight, 1));
    const maskWidth = Math.max(1, Math.round(imageWidth * maskScale));
    const maskHeight = Math.max(1, Math.round(imageHeight * maskScale));
    const rasterTotalPixels = maskWidth * maskHeight;
    const contourPoints = getProjectedChessboardContourPoints().map(([u, v]) => [u * maskScale, v * maskScale]);

    if (contourPoints.length < 3 || rasterTotalPixels <= 0) {
        const emptyValue = { occupiedPixelCount: 0, totalPixels, coverageRatio: NaN };
        chessCanvas._maskStatsCache = { key: cacheKey, value: emptyValue };
        return emptyValue;
    }

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = maskWidth;
    maskCanvas.height = maskHeight;
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });

    if (!maskCtx) {
        return { occupiedPixelCount: 0, totalPixels, coverageRatio: NaN };
    }

    maskCtx.clearRect(0, 0, maskWidth, maskHeight);
    maskCtx.fillStyle = '#ffffff';
    maskCtx.beginPath();
    maskCtx.moveTo(contourPoints[0][0], contourPoints[0][1]);
    for (let i = 1; i < contourPoints.length; i++) {
        maskCtx.lineTo(contourPoints[i][0], contourPoints[i][1]);
    }
    maskCtx.closePath();
    maskCtx.fill();

    const maskData = maskCtx.getImageData(0, 0, maskWidth, maskHeight).data;
    let occupiedMaskPixels = 0;
    for (let i = 3; i < maskData.length; i += 4) {
        if (maskData[i] > 0) occupiedMaskPixels += 1;
    }

    const coverageRatio = rasterTotalPixels > 0 ? occupiedMaskPixels / rasterTotalPixels : NaN;
    const value = {
        occupiedPixelCount: isFinite(coverageRatio) ? Math.round(coverageRatio * totalPixels) : 0,
        totalPixels,
        coverageRatio
    };
    chessCanvas._maskStatsCache = { key: cacheKey, value };
    return value;
}

function getChessboardMetrics() {
    const { intrinsics, distortion } = getChessboardViewCameraModel();
    const [, iw, ih, fx, fy, cx, cy] = intrinsics;
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = distortion;
    const [bc, br, bw, bh, center, , , extraWhitePadding] = getChessboardSettings();
    const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);
    const { coverageRatio } = calculateChessboardMaskCoverage();

    const totalWidth = (bc + 1 + (extraWhitePadding ? 2 : 0)) * bw;
    const totalHeight = (br + 1 + (extraWhitePadding ? 2 : 0)) * bh;
    const projectedPoints = [];

    for (let y = yMin; y < yMax; y++) {
        const row = [];
        for (let x = xMin; x < xMax; x++) {
            const [u, v, zc] = projectPointToImage([x * bw, y * bh, 0], fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            const visible = isFinite(u) && isFinite(v) && zc > 0 && u >= 0 && u <= iw && v >= 0 && v <= ih;
            row.push({ u, v, visible });
        }
        projectedPoints.push(row);
    }

    let minCornerGapPx = Infinity;
    for (let row = 0; row < projectedPoints.length; row++) {
        for (let col = 0; col < projectedPoints[row].length; col++) {
            const point = projectedPoints[row][col];
            if (!point?.visible) continue;

            const right = projectedPoints[row][col + 1];
            const down = projectedPoints[row + 1]?.[col];

            if (right?.visible) {
                minCornerGapPx = Math.min(minCornerGapPx, Math.hypot(point.u - right.u, point.v - right.v));
            }
            if (down?.visible) {
                minCornerGapPx = Math.min(minCornerGapPx, Math.hypot(point.u - down.u, point.v - down.v));
            }
        }
    }

    return {
        totalWidth,
        totalHeight,
        minCornerGapPx: isFinite(minCornerGapPx) ? minCornerGapPx : null,
        coverageRatio
    };
}

function eulerAnglesToRotationMatrix(rx, ry, rz) {
    const cosRx = Math.cos(rx), sinRx = Math.sin(rx);
    const cosRy = Math.cos(ry), sinRy = Math.sin(ry);
    const cosRz = Math.cos(rz), sinRz = Math.sin(rz);
    const R11 = cosRy * cosRz;
    const R12 = cosRy * sinRz;
    const R13 = -sinRy;
    const R21 = sinRx * sinRy * cosRz - cosRx * sinRz;
    const R22 = sinRx * sinRy * sinRz + cosRx * cosRz;
    const R23 = sinRx * cosRy;
    const R31 = cosRx * sinRy * cosRz + sinRx * sinRz;
    const R32 = cosRx * sinRy * sinRz - sinRx * cosRz;
    const R33 = cosRx * cosRy;
    return [R11, R12, R13, R21, R22, R23, R31, R32, R33];
}

function rotationMatrixToEulerAngles(R11, R12, R13, R21, R22, R23, R31, R32, R33) {
    const ry = -Math.asin(R13);
    const rz = Math.atan2(R12, R11);
    const rx = Math.atan2(R23, R33);
    return [rx, ry, rz];
}

function applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    // Comments are the original perspective division, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
    // let xp = xc / zc;
    // let yp = yc / zc;
    let xp = xc / Math.abs(zc);
    let yp = yc / Math.abs(zc);

    if (fisheye) {
        const r = Math.sqrt(xp * xp + yp * yp);
        if (r > 0) {
            // Comments are the original fisheye distortion formula, but it can cause issues when zc is negative (point behind the camera) or close to zero. Using atan2 with absolute value of zc can help visualize points behind the camera and avoid extreme distortion for points close to the camera.
            // let theta1 = Math.atan(Math.sqrt(xc * xc + yc * yc) / zc);
            const theta1 = Math.atan2(Math.sqrt(xc * xc + yc * yc), zc);
            const theta2 = theta1 * theta1;
            const theta3 = theta2 * theta1;
            const theta5 = theta2 * theta3;
            const theta7 = theta2 * theta5;
            const theta9 = theta2 * theta7;
            const theta_d = theta1 + k1 * theta3 + k2 * theta5 + k3 * theta7 + k4 * theta9;
            xp = (theta_d / r) * xp;
            yp = (theta_d / r) * yp;
        }
    } else {
        const r2 = xp * xp + yp * yp;
        const r4 = r2 * r2;
        const r6 = r4 * r2;
        const radial = (1 + k1 * r2 + k2 * r4 + k3 * r6) / (1 + k4 * r2 + k5 * r4 + k6 * r6);
        const dtx = 2 * p1 * xp * yp + p2 * (r2 + 2 * xp * xp);
        const dty = p1 * (r2 + 2 * yp * yp) + 2 * p2 * xp * yp;
        xp = xp * radial + dtx;
        yp = yp * radial + dty;
    }

    return [xp, yp];
}

function convertCurveValueToSlope(value, unit, focalLengthPx, pixelSizeUm, effectiveFocalLengthUm = null) {
    if (!isFinite(value)) return NaN;

    const pixelPitchUm = isFinite(pixelSizeUm) && pixelSizeUm > 0 ? pixelSizeUm : NaN;
    const focalLengthUm = isFinite(effectiveFocalLengthUm) && effectiveFocalLengthUm > 0
        ? effectiveFocalLengthUm
        : (isFinite(pixelPitchUm) && isFinite(focalLengthPx) && Math.abs(focalLengthPx) > 1e-12
            ? focalLengthPx * pixelPitchUm
            : NaN);

    switch (unit) {
        case 'deg':
            return Math.tan(value * Math.PI / 180);
        case 'rad':
            return Math.tan(value);
        case 'tanθ':
            return value;
        case 'pixel':
            return isFinite(pixelPitchUm) && isFinite(focalLengthUm) ? (value * pixelPitchUm) / focalLengthUm : NaN;
        case 'um':
            return isFinite(focalLengthUm) ? value / focalLengthUm : NaN;
        case 'mm': {
            const valueUm = value * 1e3;
            return isFinite(focalLengthUm) ? valueUm / focalLengthUm : NaN;
        }
        case 'cm': {
            const valueUm = value * 1e4;
            return isFinite(focalLengthUm) ? valueUm / focalLengthUm : NaN;
        }
        case 'm': {
            const valueUm = value * 1e6;
            return isFinite(focalLengthUm) ? valueUm / focalLengthUm : NaN;
        }
        default:
            return NaN;
    }
}

function convertSlopeToCurveValue(slope, unit, focalLengthPx, pixelSizeUm, effectiveFocalLengthUm = null) {
    if (!isFinite(slope)) return NaN;

    const pixelPitchUm = isFinite(pixelSizeUm) && pixelSizeUm > 0 ? pixelSizeUm : NaN;
    const focalLengthUm = isFinite(effectiveFocalLengthUm) && effectiveFocalLengthUm > 0
        ? effectiveFocalLengthUm
        : (isFinite(pixelPitchUm) && isFinite(focalLengthPx) && Math.abs(focalLengthPx) > 1e-12
            ? focalLengthPx * pixelPitchUm
            : NaN);

    switch (unit) {
        case 'deg':
            return Math.atan(slope) * 180 / Math.PI;
        case 'rad':
            return Math.atan(slope);
        case 'tanθ':
            return slope;
        case 'pixel':
            return isFinite(pixelPitchUm) && isFinite(focalLengthUm) ? (slope * focalLengthUm) / pixelPitchUm : NaN;
        case 'um':
            return isFinite(focalLengthUm) ? slope * focalLengthUm : NaN;
        case 'mm': {
            return isFinite(focalLengthUm) ? (slope * focalLengthUm) / 1e3 : NaN;
        }
        case 'cm': {
            return isFinite(focalLengthUm) ? (slope * focalLengthUm) / 1e4 : NaN;
        }
        case 'm': {
            return isFinite(focalLengthUm) ? (slope * focalLengthUm) / 1e6 : NaN;
        }
        default:
            return NaN;
    }
}

function convertCurveTableSampleToSlopes(xValue, yValue, unit, fx, pixelSizeUm, effectiveFocalLengthUm = null) {
    const incomingSlope = convertCurveValueToSlope(xValue, unit, fx, pixelSizeUm, effectiveFocalLengthUm);
    if (!isFinite(incomingSlope)) return null;

    const distortedSlope = convertCurveValueToSlope(yValue, unit, fx, pixelSizeUm, effectiveFocalLengthUm);
    if (!isFinite(distortedSlope)) return null;
    return { incomingSlope, distortedSlope };
}

// Fits rational distortion k1..k6 from a radial table of (rIn, rOut) slope pairs.
// Implements the Huber-weighted 1-D LM algorithm from table2param::FitRationalDistortionLM.
// rInArray / rOutArray must already be abs-filtered (center-point removal done by the caller).
// Returns denormalized OpenCV-ordered params [k1,k2,0,0,k3,k4,k5,k6], or null on failure.
function fitDistortionFromRadialTable(rInArray, rOutArray, maxIter = 100) {
    const n = rInArray.length;
    if (n < 6) return null;

    let rScale = 0;
    for (let i = 0; i < n; i++) if (rInArray[i] > rScale) rScale = rInArray[i];
    if (rScale < 1e-14) return null;

    const t = rInArray.map(r => r / rScale);
    const sObs = rInArray.map((r, i) => rOutArray[i] / r);

    let k = [0, 0, 0, 0, 0, 0];
    let lambda = 1e-3;
    let prevSSE = 1e300;

    for (let iter = 0; iter < maxIter; iter++) {
        // First pass: residuals and SSE for Huber threshold
        const res = new Array(n);
        let sse = 0;
        let valid = true;
        for (let i = 0; i < n; i++) {
            const t2 = t[i] * t[i], t4 = t2 * t2, t6 = t4 * t2;
            const A = 1 + k[0] * t2 + k[1] * t4 + k[2] * t6;
            const B = 1 + k[3] * t2 + k[4] * t4 + k[5] * t6;
            if (Math.abs(B) < 1e-14) { valid = false; break; }
            const pred = A / B;
            res[i] = pred - sObs[i];
            sse += res[i] * res[i];
        }
        if (!valid) return null;

        const huberC = 1.345 * (Math.sqrt(sse / n) + 1e-12);

        // Second pass: weighted normal equations
        const H = Array.from({ length: 6 }, () => new Array(6).fill(0));
        const g = new Array(6).fill(0);
        for (let i = 0; i < n; i++) {
            const t2 = t[i] * t[i], t4 = t2 * t2, t6 = t4 * t2;
            const A = 1 + k[0] * t2 + k[1] * t4 + k[2] * t6;
            const B = 1 + k[3] * t2 + k[4] * t4 + k[5] * t6;
            if (Math.abs(B) < 1e-14) { valid = false; break; }
            const invB = 1 / B, invB2 = invB * invB;
            const ae = Math.abs(res[i]);
            const w = ae <= huberC ? 1 : huberC / ae;
            const j = [t2 * invB, t4 * invB, t6 * invB, -A * t2 * invB2, -A * t4 * invB2, -A * t6 * invB2];
            for (let r = 0; r < 6; r++) {
                g[r] += w * j[r] * res[i];
                for (let ci = r; ci < 6; ci++) H[r][ci] += w * j[r] * j[ci];
            }
        }
        if (!valid) return null;

        // Fill lower triangle
        for (let r = 0; r < 6; r++)
            for (let ci = 0; ci < r; ci++) H[r][ci] = H[ci][r];

        // LM damping: H[d][d] += lambda * max(|H[d][d]|, 1)
        for (let d = 0; d < 6; d++)
            H[d][d] += lambda * Math.max(Math.abs(H[d][d]), 1);

        const delta = solveLinearSystem(H, g.map(v => -v));
        if (!delta) {
            lambda = Math.min(lambda * 10, 1e20);
            if (lambda > 1e19) break;
            continue;
        }

        const stepNorm = delta.reduce((s, v) => s + v * v, 0);
        if (stepNorm < 1e-24) break;

        const kt = k.map((ki, idx) => ki + delta[idx]);

        let trialSSE = 0, trialValid = true;
        for (let i = 0; i < n; i++) {
            const t2 = t[i] * t[i], t4 = t2 * t2, t6 = t4 * t2;
            const A = 1 + kt[0] * t2 + kt[1] * t4 + kt[2] * t6;
            const B = 1 + kt[3] * t2 + kt[4] * t4 + kt[5] * t6;
            if (Math.abs(B) < 1e-14) { trialValid = false; break; }
            const e = A / B - sObs[i];
            trialSSE += e * e;
        }
        if (!trialValid) {
            lambda = Math.min(lambda * 10, 1e20);
            if (lambda > 1e19) break;
            continue;
        }

        if (trialSSE < prevSSE) {
            k = kt;
            prevSSE = trialSSE;
            lambda = Math.max(lambda * 0.1, 1e-20);
            if (Math.sqrt(stepNorm) < 1e-10) break;
        } else {
            lambda = Math.min(lambda * 10, 1e20);
            if (lambda > 1e19) break;
        }
    }

    // Denormalize: fitted k[i] are in terms of t = r/rScale; convert to use r directly.
    // K_num[i] = k[i] / rScale^(2*(i+1)), K_den[i] = k[i+3] / rScale^(2*(i+1))
    const rs2 = rScale * rScale, rs4 = rs2 * rs2, rs6 = rs4 * rs2;
    // OpenCV order: [k1, k2, p1, p2, k3, k4, k5, k6]
    return [k[0] / rs2, k[1] / rs4, 0, 0, k[2] / rs6, k[3] / rs2, k[4] / rs4, k[5] / rs6];
}

function solveLinearSystem(matrix, rhs) {
    const size = Array.isArray(matrix) ? matrix.length : 0;
    if (!size || size !== rhs.length) return null;

    const augmented = matrix.map((row, rowIndex) => row.slice(0, size).concat(rhs[rowIndex]));

    for (let col = 0; col < size; col++) {
        let pivotRow = col;
        for (let row = col + 1; row < size; row++) {
            if (Math.abs(augmented[row][col]) > Math.abs(augmented[pivotRow][col])) {
                pivotRow = row;
            }
        }

        const pivotValue = augmented[pivotRow][col];
        if (!isFinite(pivotValue) || Math.abs(pivotValue) < 1e-15) return null;

        if (pivotRow !== col) {
            [augmented[col], augmented[pivotRow]] = [augmented[pivotRow], augmented[col]];
        }

        for (let j = col; j <= size; j++) {
            augmented[col][j] /= pivotValue;
        }

        for (let row = 0; row < size; row++) {
            if (row === col) continue;
            const factor = augmented[row][col];
            if (!isFinite(factor) || Math.abs(factor) < 1e-20) continue;
            for (let j = col; j <= size; j++) {
                augmented[row][j] -= factor * augmented[col][j];
            }
        }
    }

    return augmented.map(row => row[size]);
}

function evaluateCurveSampleFitError(samples, params, fisheye) {
    let totalError = 0;

    for (const sample of samples) {
        const [xPred, yPred] = applyDistortion(
            sample.xu, sample.yu, sample.rayZ,
            params[0], params[1], params[2], params[3],
            params[4], params[5], params[6], params[7],
            fisheye
        );

        if (!isFinite(xPred) || !isFinite(yPred)) return Infinity;

        const dx = xPred - sample.xDist;
        const dy = yPred - sample.yDist;
        totalError += dx * dx + dy * dy;
    }

    return totalError;
}

function fitDistortionFromCurveSamples(samples, options = {}) {
    const fitMask = Array.isArray(options.fitMask) ? options.fitMask.slice(0, 8) : Array(8).fill(true);
    const useFisheye = !!options.useFisheye;
    const sourceFisheye = !!options.sourceFisheye;
    const initialParams = Array.isArray(options.initialParams) ? options.initialParams.slice(0, 8) : Array(8).fill(0);
    const fittedParams = Array(8).fill(0);

    if (!Array.isArray(samples) || !samples.length) {
        return { params: fittedParams, fisheye: useFisheye, error: NaN };
    }

    const effectiveMask = fitMask.map(Boolean);
    if (useFisheye) {
        effectiveMask[2] = false;
        effectiveMask[3] = false;
        effectiveMask[6] = false;
        effectiveMask[7] = false;
    }

    const activeIndices = effectiveMask
        .map((enabled, index) => enabled ? index : -1)
        .filter(index => index >= 0);

    if (useFisheye === sourceFisheye) {
        activeIndices.forEach(index => {
            fittedParams[index] = Number.isFinite(initialParams[index]) ? initialParams[index] : 0;
        });
    }

    if (!activeIndices.length) {
        return { params: fittedParams, fisheye: useFisheye, error: 0 };
    }

    let currentParams = fittedParams.slice();
    let currentError = evaluateCurveSampleFitError(samples, currentParams, useFisheye);
    let damping = 1e-3;

    for (let iter = 0; iter < 24; iter++) {
        const dimension = activeIndices.length;
        const normal = Array.from({ length: dimension }, () => Array(dimension).fill(0));
        const rhs = Array(dimension).fill(0);

        for (const sample of samples) {
            const [baseX, baseY] = applyDistortion(
                sample.xu, sample.yu, sample.rayZ,
                currentParams[0], currentParams[1], currentParams[2], currentParams[3],
                currentParams[4], currentParams[5], currentParams[6], currentParams[7],
                useFisheye
            );
            if (!isFinite(baseX) || !isFinite(baseY)) {
                currentError = Infinity;
                break;
            }

            const residualX = baseX - sample.xDist;
            const residualY = baseY - sample.yDist;
            const jacobian = activeIndices.map(index => {
                const delta = 1e-4 * Math.max(1, Math.abs(currentParams[index]));
                const trialParams = currentParams.slice();
                trialParams[index] += delta;
                const [trialX, trialY] = applyDistortion(
                    sample.xu, sample.yu, sample.rayZ,
                    trialParams[0], trialParams[1], trialParams[2], trialParams[3],
                    trialParams[4], trialParams[5], trialParams[6], trialParams[7],
                    useFisheye
                );
                return [
                    isFinite(trialX) ? (trialX - baseX) / delta : 0,
                    isFinite(trialY) ? (trialY - baseY) / delta : 0
                ];
            });

            for (let row = 0; row < dimension; row++) {
                const [jx, jy] = jacobian[row];
                rhs[row] -= jx * residualX + jy * residualY;
                for (let col = row; col < dimension; col++) {
                    const [kx, ky] = jacobian[col];
                    normal[row][col] += jx * kx + jy * ky;
                }
            }
        }

        if (!isFinite(currentError)) break;

        for (let row = 0; row < activeIndices.length; row++) {
            for (let col = 0; col < row; col++) {
                normal[row][col] = normal[col][row];
            }
            normal[row][row] += damping * Math.max(1, normal[row][row]);
        }

        const deltaVector = solveLinearSystem(normal, rhs);
        if (!deltaVector) break;

        const candidateParams = currentParams.slice();
        let stepNorm = 0;
        activeIndices.forEach((paramIndex, deltaIndex) => {
            const delta = deltaVector[deltaIndex];
            candidateParams[paramIndex] += delta;
            stepNorm += delta * delta;
        });

        const candidateError = evaluateCurveSampleFitError(samples, candidateParams, useFisheye);
        if (isFinite(candidateError) && candidateError < currentError) {
            currentParams = candidateParams;
            currentError = candidateError;
            damping = Math.max(damping * 0.5, 1e-6);
            if (stepNorm < 1e-18) break;
        } else {
            damping = Math.min(damping * 4, 1e6);
        }
    }

    return { params: currentParams, fisheye: useFisheye, error: currentError };
}

function projectPointToImage(p3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_wc, ry_wc, rz_wc);
    const [xw, yw, zw] = p3d;

    const xc = R11 * xw + R12 * yw + R13 * zw + tx_wc;
    const yc = R21 * xw + R22 * yw + R23 * zw + ty_wc;
    const zc = R31 * xw + R32 * yw + R33 * zw + tz_wc;

    const [xp, yp] = applyDistortion(xc, yc, zc, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    const u = fx * xp + cx;
    const v = fy * yp + cy;

    return [u, v, zc];
}

function projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    let [u, v, zc] = projectPointToImage(p3d, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    u = u * chessCanvas.width / iw;
    v = v * chessCanvas.height / ih;
    return [u, v, zc];
}

function undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, maxIter = 30, eps = 1e-3) {
    const dampingStep = 10.0;
    const dampingMin = 1e-20;
    const dampingMax = 1e20;

    if (fisheye) {
        const thetaDist = Math.hypot(xDist, yDist);
        if (thetaDist === 0) return [0, 0, 1];

        const evaluateTheta = (theta) => {
            const t2 = theta * theta;
            const t3 = t2 * theta;
            const t4 = t2 * t2;
            const t5 = t3 * t2;
            const t6 = t3 * t3;
            const t7 = t4 * t3;
            const t8 = t4 * t4;
            const t9 = t5 * t4;
            const thetaPred = theta + k1 * t3 + k2 * t5 + k3 * t7 + k4 * t9;
            const error = thetaDist - thetaPred;
            const jacobian = 1 + 3 * k1 * t2 + 5 * k2 * t4 + 7 * k3 * t6 + 9 * k4 * t8;
            return { error, cost: error * error, jacobian };
        };

        let theta = Math.min(thetaDist, Math.PI - 1e-6);
        let damping = 1e-3;
        let state = evaluateTheta(theta);

        for (let iter = 0; iter < maxIter; iter++) {
            if (!isFinite(state.cost) || !isFinite(state.jacobian)) break;

            let H = state.jacobian * state.jacobian;
            H = H < 1e-12 ? H + damping : H + H * damping;
            if (!isFinite(H) || Math.abs(H) < 1e-20) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const delta = (state.jacobian * state.error) / H;
            if (!isFinite(delta)) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const thetaCandidate = Math.max(0, Math.min(theta + delta, Math.PI - 1e-6));
            const nextState = evaluateTheta(thetaCandidate);

            if (nextState.cost < state.cost) {
                const step2 = delta * delta;
                theta = thetaCandidate;
                state = nextState;
                damping = Math.max(damping / dampingStep, dampingMin);
                if (step2 < 1e-12) break;
            } else {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
            }
        }

        const z = theta > Math.PI * 0.5 ? -1 : 1;
        const frontTheta = z > 0 ? theta : (Math.PI - theta);
        const r = Math.tan(frontTheta);
        const scale = r / thetaDist;
        return [xDist * scale, yDist * scale, z];
    } else {
        const evaluatePerspective = (x, y) => {
            const r2 = x * x + y * y;
            const r4 = r2 * r2;
            const r6 = r4 * r2;

            const A = 1 + k1 * r2 + k2 * r4 + k3 * r6;
            const B = 1 + k4 * r2 + k5 * r4 + k6 * r6;
            const invB = Math.abs(B) > 1e-12 ? 1 / B : 1;
            const factor = A * invB;

            const xPred = x * factor + 2 * p1 * x * y + p2 * (r2 + 2 * x * x);
            const yPred = y * factor + p1 * (r2 + 2 * y * y) + 2 * p2 * x * y;
            const ex = xDist - xPred;
            const ey = yDist - yPred;

            const dA_dx = x * (2 * k1 + 4 * k2 * r2 + 6 * k3 * r4);
            const dA_dy = y * (2 * k1 + 4 * k2 * r2 + 6 * k3 * r4);
            const dB_dx = x * (2 * k4 + 4 * k5 * r2 + 6 * k6 * r4);
            const dB_dy = y * (2 * k4 + 4 * k5 * r2 + 6 * k6 * r4);

            const invB2 = invB * invB;
            const dfactor_dx = (dA_dx * B - A * dB_dx) * invB2;
            const dfactor_dy = (dA_dy * B - A * dB_dy) * invB2;

            const J00 = factor + x * dfactor_dx + 2 * p1 * y + 6 * p2 * x;
            const J01 = x * dfactor_dy + 2 * p1 * x + 2 * p2 * y;
            const J10 = y * dfactor_dx + 2 * p1 * x + 2 * p2 * y;
            const J11 = factor + y * dfactor_dy + 6 * p1 * y + 2 * p2 * x;

            return {
                ex,
                ey,
                cost: ex * ex + ey * ey,
                J00,
                J01,
                J10,
                J11
            };
        };

        let x = xDist;
        let y = yDist;
        let damping = 1e-3;
        let state = evaluatePerspective(x, y);

        for (let iter = 0; iter < maxIter; ++iter) {
            if (!isFinite(state.cost)) break;

            const JTJ00 = state.J00 * state.J00 + state.J10 * state.J10;
            const JTJ01 = state.J00 * state.J01 + state.J10 * state.J11;
            const JTJ11 = state.J01 * state.J01 + state.J11 * state.J11;
            const JTe0 = state.J00 * state.ex + state.J10 * state.ey;
            const JTe1 = state.J01 * state.ex + state.J11 * state.ey;

            let H00 = JTJ00 < 1e-12 ? JTJ00 + damping : JTJ00 + JTJ00 * damping;
            const H01 = JTJ01;
            const H10 = JTJ01;
            let H11 = JTJ11 < 1e-12 ? JTJ11 + damping : JTJ11 + JTJ11 * damping;

            let det = H00 * H11 - H01 * H10;
            if (!isFinite(det) || Math.abs(det) < 1e-24) {
                H00 += damping;
                H11 += damping;
                det = H00 * H11 - H01 * H10;
                if (!isFinite(det) || Math.abs(det) < 1e-30) {
                    damping = Math.min(damping * dampingStep, dampingMax);
                    if (damping >= dampingMax) break;
                    continue;
                }
            }

            const invDet = 1.0 / det;
            const dx = (H11 * JTe0 - H01 * JTe1) * invDet;
            const dy = (-H10 * JTe0 + H00 * JTe1) * invDet;

            if (!isFinite(dx) || !isFinite(dy) || Math.abs(dx) > 1e6 || Math.abs(dy) > 1e6) {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
                continue;
            }

            const xCandidate = x + dx;
            const yCandidate = y + dy;
            const nextState = evaluatePerspective(xCandidate, yCandidate);

            if (nextState.cost < state.cost) {
                const stepNorm2 = dx * dx + dy * dy;
                x = xCandidate;
                y = yCandidate;
                state = nextState;
                damping = Math.max(damping / dampingStep, dampingMin);
                if (stepNorm2 < eps) break;
            } else {
                damping = Math.min(damping * dampingStep, dampingMax);
                if (damping >= dampingMax) break;
            }
        }

        return [x, y, 1];
    }
}

function updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye) {
    const width = chessCanvas.width;
    const height = chessCanvas.height;
    const dx = new Float32Array(width * height);
    const dy = new Float32Array(width * height);
    const dz = new Float32Array(width * height);

    const fxCanvas = fx * width / iw;
    const fyCanvas = fy * height / ih;
    const cxCanvas = cx * width / iw;
    const cyCanvas = cy * height / ih;

    for (let v = 0; v < height; v++) {
        for (let u = 0; u < width; u++) {
            const xDist = (u - cxCanvas) / fxCanvas;
            const yDist = (v - cyCanvas) / fyCanvas;
            const [xu, yu, zu] = undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            const idx = v * width + u;
            dx[idx] = xu;
            dy[idx] = yu;
            dz[idx] = zu;
        }
    }

    return [dx, dy, dz, width, height];
}

function renderChessboard() {
    const { intrinsics, distortion } = getChessboardViewCameraModel();
    const [, iw, ih, fx, fy, cx, cy] = intrinsics;
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = distortion;
    const [bc, br, bw, bh, center, showSquares, showCircles, extraWhitePadding] = getChessboardSettings();

    chessCtx.clearRect(0, 0, chessCanvas.width, chessCanvas.height);

    if (showSquares) {
        const width = chessCanvas.width;
        const height = chessCanvas.height;
        const img = chessCtx.getImageData(0, 0, width, height);
        const data = img.data;

        const undistortKey = [
            chessCanvas.width, chessCanvas.height,
            iw, ih, fx, fy, cx, cy,
            k1, k2, p1, p2, k3, k4, k5, k6,
            fisheye ? 1 : 0
        ].map(value => Number.isFinite(value) ? Number(value).toFixed(6) : String(value)).join('|');

        if (!chessCanvas._undistortTable || chessCanvas._undistortTableKey !== undistortKey) {
            chessCanvas._undistortTable = updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
            chessCanvas._undistortTableKey = undistortKey;
        }
        const [dxTable, dyTable, dzTable] = chessCanvas._undistortTable;

        const [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);
        const boardXMin = (center ? -(bc + 1) / 2 : -1) * bw;
        const boardXMax = (center ? (bc + 1) / 2 : bc) * bw;
        const boardYMin = (center ? -(br + 1) / 2 : -1) * bh;
        const boardYMax = (center ? (br + 1) / 2 : br) * bh;
        const paddedXMin = extraWhitePadding ? boardXMin - bw : boardXMin;
        const paddedXMax = extraWhitePadding ? boardXMax + bw : boardXMax;
        const paddedYMin = extraWhitePadding ? boardYMin - bh : boardYMin;
        const paddedYMax = extraWhitePadding ? boardYMax + bh : boardYMax;

        for (let v = 0; v < height; v++) {
            for (let u = 0; u < width; u++) {
                const idx = v * width + u;
                const dx_v = dxTable[idx];
                const dy_v = dyTable[idx];
                const dz_v = dzTable[idx];

                const dwx = R11 * dx_v + R12 * dy_v + R13 * dz_v;
                const dwy = R21 * dx_v + R22 * dy_v + R23 * dz_v;
                const dwz = R31 * dx_v + R32 * dy_v + R33 * dz_v;

                if (dwz !== 0) {
                    const s = -tz_cw / dwz;
                    if (s > 0) {
                        const X = tx_cw + s * dwx;
                        const Y = ty_cw + s * dwy;
                        if (X >= paddedXMin && X <= paddedXMax && Y >= paddedYMin && Y <= paddedYMax) {
                            const inWhitePadding = extraWhitePadding
                                && (X < boardXMin || X > boardXMax || Y < boardYMin || Y > boardYMax);
                            let color = 255;
                            if (!inWhitePadding) {
                                const xi = Math.floor((X - boardXMin) / bw);
                                const yi = Math.floor((Y - boardYMin) / bh);
                                color = ((xi + yi) % 2 === 0) ? 255 : 0;
                            }
                            const pixel = idx * 4;
                            data[pixel] = color;
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
        const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);

        for (let y = yMin; y < yMax; y++) {
            for (let x = xMin; x < xMax; x++) {
                const p3d = [x * bw, y * bh, 0];
                const [u, v, zc] = projectPoint(p3d, iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
                chessCtx.fillStyle = zc > 0 ? 'red' : 'blue';
                chessCtx.beginPath();
                chessCtx.arc(u, v, 3, 0, 2 * Math.PI);
                chessCtx.fill();
            }
        }
    }
}

function findFovLimit(rayDirX, rayDirY, incomingStepDeg = 0.09, intrinsicsOverride = null, distortionOverride = null) {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = intrinsicsOverride || getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = distortionOverride || getDistortion();

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

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

// Extrinsics state (global)
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

function getChessboardMetrics() {
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, , , extraWhitePadding] = getChessboardSettings();
    const { xMin, xMax, yMin, yMax } = getChessboardCornerRanges(bc, br, center);

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
        minCornerGapPx: isFinite(minCornerGapPx) ? minCornerGapPx : null
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

function undistortNormalized(xDist, yDist, k1, k2, p1, p2, k3, k4, k5, k6, fisheye, maxIter = 30, eps = 1e-2) {
    if (fisheye) {
        const thetaDist = Math.hypot(xDist, yDist);
        if (thetaDist === 0) return [0, 0, 1];
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
            if (!isFinite(df) || Math.abs(df) < 1e-14) break;
            const step = f / df;
            theta -= step;
            theta = Math.max(0, Math.min(theta, Math.PI - 1e-6));
            if (Math.abs(step) < 1e-12) break;
        }
        const z = theta > Math.PI * 0.5 ? -1 : 1;
        const frontTheta = z > 0 ? theta : (Math.PI - theta);
        const r = Math.tan(frontTheta);
        const scale = r / thetaDist;
        return [xDist * scale, yDist * scale, z];
    }

    let x = xDist, y = yDist;
    let out = applyDistortion(x, y, 1, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
    let r0 = out[0] - xDist, r1 = out[1] - yDist;
    let cost = r0 * r0 + r1 * r1;
    let lambda = 1e-3;
    const maxLambda = 1e16;

    for (let iter = 0; iter < maxIter; ++iter) {
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

        const J00 = radial + x * dradial_dx + dtx_dx;
        const J01 = x * dradial_dy + dtx_dy;
        const J10 = y * dradial_dx + dty_dx;
        const J11 = radial + y * dradial_dy + dty_dy;

        const JTJ00 = J00 * J00 + J10 * J10;
        const JTJ01 = J00 * J01 + J10 * J11;
        const JTJ11 = J01 * J01 + J11 * J11;
        const JTr0 = J00 * r0 + J10 * r1;
        const JTr1 = J01 * r0 + J11 * r1;

        const H00 = JTJ00 * (1 + lambda);
        const H01 = JTJ01;
        const H10 = JTJ01;
        const H11 = JTJ11 * (1 + lambda);

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
    const [, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();
    const [bc, br, bw, bh, center, showSquares, showCircles, extraWhitePadding] = getChessboardSettings();

    chessCtx.clearRect(0, 0, chessCanvas.width, chessCanvas.height);

    if (showSquares) {
        const width = chessCanvas.width;
        const height = chessCanvas.height;
        const img = chessCtx.getImageData(0, 0, width, height);
        const data = img.data;

        if (!chessCanvas._undistortTable) {
            chessCanvas._undistortTable = updateUndistortTable(iw, ih, fx, fy, cx, cy, k1, k2, p1, p2, k3, k4, k5, k6, fisheye);
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

function findFovLimit(rayDirX, rayDirY, incomingStepDeg = 0.09) {
    const [pixelSizeUm, iw, ih, fx, fy, cx, cy] = getIntrinsics();
    const [k1, k2, p1, p2, k3, k4, k5, k6, fisheye] = getDistortion();

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

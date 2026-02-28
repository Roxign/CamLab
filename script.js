const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

// Initial Parameters
let canvas_w = 640, canvas_h = 360;
let iw = 1920, ih = 1080, fx = 1000, fy = 1000, cx = 960, cy = 540;
let k1 = 0, k2 = 0, p1 = 0, p2 = 0, k3 = 0, k4 = 0, k5 = 0, k6 = 0, fisheye = false;
let bc = 12, br = 9, bw = 100, bh = 100, center = true, showSquares = false, showCircles = true;
let rx_wc = 0, ry_wc = 0, rz_wc = 0, tx_wc = 0, ty_wc = 0, tz_wc = 1000;
let rx_cw = 0, ry_cw = 0, rz_cw = 0, tx_cw = 0, ty_cw = 0, tz_cw = -1000;
let inverse = false;

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
    [xp, yp] = applyDistortion(xc, yc, zc);

    // apply intrinsics
    let u = fx * xp + cx;
    let v = fy * yp + cy;

    // scale to canvas size (this allows the intrinsic parameters to be specified in terms of an arbitrary image size, independent of the canvas display size)
    u = u * canvas.width / iw;
    v = v * canvas.height / ih;
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
    let width = canvas.width, height = canvas.height;
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
function drawPoints() {
    // clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // if enabled, use the undistortion table to determine the color of each pixel based on whether the corresponding ray intersects a white or black square on the chessboard. This visualizes the effect of the intrinsics and distortion on the mapping from camera rays to the world plane.
    if (showSquares) {
        // create a fresh image buffer and fill it using the slopes
        let width = canvas.width, height = canvas.height;
        let img = ctx.getImageData(0, 0, width, height);
        let data = img.data;

        // compute rotation matrix once and reuse (camera->world case)
        let [R11, R12, R13, R21, R22, R23, R31, R32, R33] = eulerAnglesToRotationMatrix(rx_cw, ry_cw, rz_cw);

        // precompute the world coordinate bounds of the chessboard for ray intersection tests, based on the current board parameters. The board is centered on the origin by default, but can be shifted by unchecking "center".
        let x_min = center ? -(bc + 1) / 2 : -1;
        let x_max = center ? (bc + 1) / 2 : bc;
        let y_min = center ? -(br + 1) / 2 : -1;
        let y_max = center ? (br + 1) / 2 : br;
        x_min *= bw; x_max *= bw;
        y_min *= bh; y_max *= bh;

        // for each pixel, use the undistortion table to get the corresponding ray direction in camera space, rotate it into world space, and check if it intersects the chessboard plane within a white or black square. This is effectively raycasting from the camera through the distorted image plane into the world to see what color it hits on the chessboard.
        for (let v = 0; v < height; v++) {
            for (let u = 0; u < width; u++) {
                // get the undistorted ray direction for this pixel from the precomputed table
                let idx = v * width + u;
                let dx = undistortTable.dx[idx];
                let dy = undistortTable.dy[idx];
                let dz = 1;

                // rotate the ray direction from camera space to world space using the camera->world rotation matrix, and then compute the intersection with the chessboard plane (z=0 in world coordinates) to determine the corresponding point on the chessboard that this pixel maps to. Then check if that point is within the bounds of the chessboard and whether it falls on a white or black square to determine the pixel color.
                let dwx = R11 * dx + R12 * dy + R13 * dz;
                let dwy = R21 * dx + R22 * dy + R23 * dz;
                let dwz = R31 * dx + R32 * dy + R33 * dz;

                // ray-plane intersection to find where the ray from the camera through this pixel hits the chessboard plane (z=0 in world coordinates). The ray can be parameterized as (tx_cw, ty_cw, tz_cw) + s * (dwx, dwy, dwz), and we want to find s such that the z component is 0, which gives us the intersection point in world coordinates. We then check if that point is within the bounds of the chessboard and determine its color.
                if (dwz !== 0) {
                    // solve for s where the ray intersects the plane z=0: tz_cw + s * dwz = 0 => s = -tz_cw / dwz. We only consider intersections in front of the camera (s > 0) to avoid coloring pixels based on rays that go backwards through the camera. Then we compute the intersection point (X, Y) in world coordinates and check if it falls within the chessboard bounds. If it does, we determine whether it's a white or black square based on its coordinates and set the pixel color accordingly.
                    let s = -tz_cw / dwz;

                    // only consider intersections in front of the camera
                    if (s > 0) {
                        // compute the intersection point in world coordinates
                        let X = tx_cw + s * dwx;
                        let Y = ty_cw + s * dwy;

                        // check if the intersection point is within the bounds of the chessboard
                        if (X >= x_min && X <= x_max && Y >= y_min && Y <= y_max) {
                            // determine if the intersection point falls on a white or black square by checking the integer coordinates of the square it falls into. The color alternates in a checkerboard pattern, so we can determine the color by summing the integer coordinates and checking if it's even or odd. We then set the pixel color to white (255) or black (0) accordingly.
                            let xi = Math.floor((X - x_min) / bw);
                            let yi = Math.floor((Y - y_min) / bh);
                            color = ((xi + yi) % 2 === 0) ? 255 : 0;

                            // set the pixel color in the image data buffer. The image data is a flat array where each pixel is represented by 4 consecutive values (R, G, B, A), so we multiply the pixel index by 4 to get the starting index for that pixel's color values. We set R, G, and B to the same value for grayscale, and A (alpha) to 255 for full opacity.
                            idx = idx * 4;
                            data[idx + 0] = color;
                            data[idx + 1] = color;
                            data[idx + 2] = color;
                            data[idx + 3] = 255;
                        }
                    }
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    // project and draw corners if enabled
    if (showCircles) {
        // overlay filled circles on corners if requested
        objp.forEach(p3d => {
            let [u, v, zc] = projectPoint(p3d);
            if (zc > 0) {
                ctx.fillStyle = "red";
            }
            else {
                ctx.fillStyle = "blue";
            }
            ctx.beginPath();
            ctx.arc(u, v, 3, 0, 2 * Math.PI);
            ctx.fill();
        });
    }
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
    drawPoints();
}

// update cx and canvas size when iw changes, keeping cx in the center by default. This function is called whenever the image width (iw) parameter is changed, and it updates the principal point cx to be at the center of the new image width by default. It also updates the maximum value of the cx slider to match the new image width, and resizes the canvas accordingly to maintain the correct aspect ratio based on the new image dimensions.
function update_iw() {
    cx = iw / 2;
    document.getElementById('cx').value = cx;
    document.getElementById('cxText').value = cx;
    document.getElementById('cx').max = iw;
    canvas.width = iw * canvas_w / iw;
    canvas.height = ih * canvas_w / iw;
}

// update cy and canvas size when ih changes, keeping cy in the center by default. This function is called whenever the image height (ih) parameter is changed, and it updates the principal point cy to be at the center of the new image height by default. It also updates the maximum value of the cy slider to match the new image height, and resizes the canvas accordingly to maintain the correct aspect ratio based on the new image dimensions.
function update_ih() {
    cy = ih / 2;
    document.getElementById('cy').value = cy;
    document.getElementById('cyText').value = cy;
    document.getElementById('cy').max = ih;
    canvas.height = ih * canvas_w / iw;
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
    drawPoints();
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
    drawPoints();
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
    drawPoints();
});
document.getElementById('showSquares').addEventListener('input', function () {
    showSquares = this.checked;
    if (showSquares) updateUndistortTable();
    drawPoints();
});
document.getElementById('showCircles').addEventListener('input', function () {
    showCircles = this.checked;
    drawPoints();
});

// Reset
document.getElementById('reset').addEventListener('click', () => location.reload());

// initialize 3D corner points of the chessboard based on initial parameters
objp = [];
update_objp();

// undistortion lookup table when showing squares
let undistortTable = null;
if (showSquares) updateUndistortTable();

// initial draw
drawPoints();
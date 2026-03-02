// pyeto.js - JavaScript implementation of FAO-56 Penman-Monteith (equivalent to Python's PyETo)

export function deg2rad(degrees) {
    return degrees * (Math.PI / 180.0);
}

export function svp_from_t(t) {
    return 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
}

export function avp_from_rhmean(svp_tmin, svp_tmax, rh_mean) {
    return (rh_mean / 100.0) * ((svp_tmax + svp_tmin) / 2.0);
}

export function delta_svp(t) {
    const tmp = 0.6108 * Math.exp((17.27 * t) / (t + 237.3));
    return (4098.0 * tmp) / Math.pow((t + 237.3), 2);
}

export function psy_const(p) {
    return 0.000665 * p;
}

export function extraterrestrial_rad(j, latitude_rad) {
    const dr = 1.0 + 0.033 * Math.cos((2.0 * Math.PI / 365.0) * j);
    const solar_dec = 0.409 * Math.sin((2.0 * Math.PI / 365.0) * j - 1.39);
    const ws = Math.acos(-Math.tan(latitude_rad) * Math.tan(solar_dec));
    const term1 = ws * Math.sin(latitude_rad) * Math.sin(solar_dec);
    const term2 = Math.cos(latitude_rad) * Math.cos(solar_dec) * Math.sin(ws);
    return (24.0 * 60.0 / Math.PI) * 0.0820 * dr * (term1 + term2);
}

export function cs_rad(altitude, ra) {
    return ra * (0.75 + 2e-5 * altitude);
}

export function net_in_sw_rad(rs) {
    return (1.0 - 0.23) * rs;
}

export function net_out_lw_rad(tmin, tmax, ea, rs, rso) {
    const sigma = 4.901e-9;
    const tmax_k = tmax + 273.16;
    const tmin_k = tmin + 273.16;
    // Bounded rs/rso to handle cases where rs > rso slightly
    const rs_rso = Math.min(rs / rso, 1.0);
    return sigma * ((Math.pow(tmax_k, 4) + Math.pow(tmin_k, 4)) / 2.0) * (0.34 - 0.14 * Math.sqrt(ea)) * (1.35 * rs_rso - 0.35);
}

export function net_rad(rns, rnl) {
    return rns - rnl;
}

export function fao56_penman_monteith(net_rad, t, ws, svp, avp, delta_svp, psy_const, shf = 0.0) {
    const num = 0.408 * delta_svp * (net_rad - shf) + psy_const * (900.0 / (t + 273.0)) * ws * (svp - avp);
    const den = delta_svp + psy_const * (1.0 + 0.34 * ws);
    return num / den;
}

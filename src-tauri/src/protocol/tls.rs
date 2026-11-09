use std::sync::Arc;

use rustls::client::WebPkiServerVerifier;
use rustls::client::danger::{HandshakeSignatureValid, ServerCertVerified, ServerCertVerifier};
use rustls::crypto::CryptoProvider;
use rustls::pki_types::{CertificateDer, ServerName, UnixTime};
use rustls::{DigitallySignedStruct, Error as RustlsError, SignatureScheme};
use sha2::{Digest, Sha256};
use suppaftp::tokio::AsyncRustlsConnector;

use crate::domain::connection::{TlsOptions, normalize_certificate_pin};
use crate::error::{AppError, ErrorCode};

/// Build the rustls connector used by explicit and implicit FTPS.
///
/// The default verifier is the platform trust store. A custom CA replaces it,
/// and an optional SHA-256 pin is enforced on top of whichever chain verifier
/// is active. `allow_invalid_certificates` skips chain and hostname checks but
/// still verifies the handshake signature and any configured pin.
pub fn build_connector(options: &TlsOptions) -> Result<AsyncRustlsConnector, AppError> {
    let provider = Arc::new(rustls::crypto::ring::default_provider());

    let base: Arc<dyn ServerCertVerifier> = if options.allow_invalid_certificates {
        Arc::new(AcceptAnyServerCert {
            provider: provider.clone(),
        })
    } else if let Some(ca_file) = &options.ca_file {
        let roots = load_roots(ca_file)?;
        let verifier =
            WebPkiServerVerifier::builder_with_provider(Arc::new(roots), provider.clone())
                .build()
                .map_err(|error| {
                    tls_error(
                        "The custom CA could not be used for TLS verification.",
                        error.to_string(),
                    )
                })?;
        verifier as Arc<dyn ServerCertVerifier>
    } else {
        let verifier =
            rustls_platform_verifier::Verifier::new(provider.clone()).map_err(|error| {
                tls_error(
                    "The system certificate store could not be loaded.",
                    error.to_string(),
                )
            })?;
        Arc::new(verifier)
    };

    let verifier: Arc<dyn ServerCertVerifier> = match &options.certificate_pin {
        Some(pin) => Arc::new(PinnedVerifier {
            inner: base,
            pin: parse_pin(pin)?,
        }),
        None => base,
    };

    let config = rustls::ClientConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .map_err(|error| tls_error("TLS could not be configured.", error.to_string()))?
        .dangerous()
        .with_custom_certificate_verifier(verifier)
        .with_no_client_auth();

    Ok(AsyncRustlsConnector::from(
        tokio_rustls::TlsConnector::from(Arc::new(config)),
    ))
}

fn load_roots(path: &str) -> Result<rustls::RootCertStore, AppError> {
    let pem = std::fs::read(path).map_err(|error| {
        tls_error(
            "The custom CA file could not be read.",
            format!("{path}: {error}"),
        )
    })?;

    let mut roots = rustls::RootCertStore::empty();
    let mut added = 0usize;
    for certificate in rustls_pemfile::certs(&mut pem.as_slice()) {
        let certificate = certificate.map_err(|error| {
            tls_error(
                "The custom CA file is not a valid PEM bundle.",
                error.to_string(),
            )
        })?;
        roots.add(certificate).map_err(|error| {
            tls_error(
                "The custom CA file contains an invalid certificate.",
                error.to_string(),
            )
        })?;
        added += 1;
    }

    if added == 0 {
        return Err(tls_error(
            "The custom CA file contains no certificates.",
            "empty PEM bundle",
        ));
    }
    Ok(roots)
}

fn parse_pin(pin: &str) -> Result<[u8; 32], AppError> {
    let normalized = normalize_certificate_pin(pin).map_err(AppError::invalid_input)?;
    let mut bytes = [0u8; 32];
    for (index, chunk) in normalized.as_bytes().chunks(2).enumerate() {
        let pair = std::str::from_utf8(chunk)
            .map_err(|_| AppError::invalid_input("The certificate pin is not valid hex."))?;
        bytes[index] = u8::from_str_radix(pair, 16)
            .map_err(|_| AppError::invalid_input("The certificate pin is not valid hex."))?;
    }
    Ok(bytes)
}

fn tls_error(message: impl Into<String>, detail: impl Into<String>) -> AppError {
    AppError::new(ErrorCode::TlsCertificate, message).with_detail(detail)
}

/// Accepts any certificate chain. Used only when the user explicitly disables
/// verification; the handshake signature is still checked.
#[derive(Debug)]
struct AcceptAnyServerCert {
    provider: Arc<CryptoProvider>,
}

impl ServerCertVerifier for AcceptAnyServerCert {
    fn verify_server_cert(
        &self,
        _end_entity: &CertificateDer<'_>,
        _intermediates: &[CertificateDer<'_>],
        _server_name: &ServerName<'_>,
        _ocsp_response: &[u8],
        _now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        rustls::crypto::verify_tls12_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        rustls::crypto::verify_tls13_signature(
            message,
            cert,
            dss,
            &self.provider.signature_verification_algorithms,
        )
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.provider
            .signature_verification_algorithms
            .supported_schemes()
    }
}

/// Enforces a SHA-256 fingerprint on top of an existing chain verifier.
#[derive(Debug)]
struct PinnedVerifier {
    inner: Arc<dyn ServerCertVerifier>,
    pin: [u8; 32],
}

impl ServerCertVerifier for PinnedVerifier {
    fn verify_server_cert(
        &self,
        end_entity: &CertificateDer<'_>,
        intermediates: &[CertificateDer<'_>],
        server_name: &ServerName<'_>,
        ocsp_response: &[u8],
        now: UnixTime,
    ) -> Result<ServerCertVerified, RustlsError> {
        self.inner.verify_server_cert(
            end_entity,
            intermediates,
            server_name,
            ocsp_response,
            now,
        )?;

        let digest = Sha256::digest(end_entity.as_ref());
        if digest.as_slice() != self.pin {
            return Err(RustlsError::General(
                "The server certificate does not match the pinned fingerprint.".into(),
            ));
        }
        Ok(ServerCertVerified::assertion())
    }

    fn verify_tls12_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        self.inner.verify_tls12_signature(message, cert, dss)
    }

    fn verify_tls13_signature(
        &self,
        message: &[u8],
        cert: &CertificateDer<'_>,
        dss: &DigitallySignedStruct,
    ) -> Result<HandshakeSignatureValid, RustlsError> {
        self.inner.verify_tls13_signature(message, cert, dss)
    }

    fn supported_verify_schemes(&self) -> Vec<SignatureScheme> {
        self.inner.supported_verify_schemes()
    }

    fn requires_raw_public_keys(&self) -> bool {
        self.inner.requires_raw_public_keys()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_colon_separated_and_prefixed_pins() {
        let pin = parse_pin(
            "SHA256:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:\
             AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99",
        )
        .expect("valid pin");
        assert_eq!(pin[0], 0xaa);
        assert_eq!(pin[31], 0x99);
        assert!(parse_pin("short").is_err());
        assert!(parse_pin(&"zz".repeat(32)).is_err());
    }

    #[test]
    fn rejects_missing_or_empty_ca_files() {
        let missing = TlsOptions {
            ca_file: Some("/definitely/not/a/real/ca.pem".into()),
            ..TlsOptions::default()
        };
        assert_eq!(
            build_connector(&missing).expect_err("missing CA").code,
            ErrorCode::TlsCertificate
        );

        let dir = tempfile::tempdir().expect("temp dir");
        let empty = dir.path().join("empty.pem");
        std::fs::write(&empty, b"not a certificate").expect("write fixture");
        let invalid = TlsOptions {
            ca_file: Some(empty.to_string_lossy().into_owned()),
            ..TlsOptions::default()
        };
        assert_eq!(
            build_connector(&invalid).expect_err("invalid CA").code,
            ErrorCode::TlsCertificate
        );
    }
}

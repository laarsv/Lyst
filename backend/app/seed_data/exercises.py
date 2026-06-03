# app/seed_data/exercises.py
#
# Kuratierte Standard-Uebungen fuer das Fitness-Modul (Lyst).
# Werden vom idempotenten Uebungs-Seeder als globale Uebungen
# (owner_id IS NULL) per Upsert-by-name eingespielt.
#
# Felder entsprechen den exercises-Spalten:
#   name           str   (eindeutiger Seed-Key, NICHT nachtraeglich umbenennen)
#   muscle_group   str   (eine aus MUSCLE_GROUPS)
#   type           str   AUFBAU | DEHNEN | PHYSIO
#   location       str   STUDIO | HOME | BEIDES
#   tracking_type  str   REPS | WEIGHT_REPS | TIME
#   instructions   str   kurze deutsche Anleitung
#   image_url      None  (Seeds ohne Bild; Lars haengt eigene Bilder spaeter an)
#
# WICHTIG: keine typografischen Anfuehrungszeichen in Strings (Python-SyntaxError).

MUSCLE_GROUPS = [
    "Brust", "Rücken", "Schultern", "Bizeps", "Trizeps",
    "Core", "Beine", "Waden", "Gesäß", "Ganzkörper", "Mobilität",
]

EXERCISES = [
    # --- Brust ---
    {"name": "Bankdrücken Langhantel", "muscle_group": "Brust", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Flach auf der Bank, Langhantel schulterbreit zur Brust senken und kontrolliert hochdrücken. Schulterblätter zusammen.", "image_url": None},
    {"name": "Schrägbankdrücken Kurzhantel", "muscle_group": "Brust", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Bank auf 30-45 Grad. Kurzhanteln aus Brusthöhe nach oben drücken, oben kurz halten.", "image_url": None},
    {"name": "Liegestütze", "muscle_group": "Brust", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Körper als gerade Linie, Hände etwas weiter als schulterbreit. Brust Richtung Boden senken, hochdrücken.", "image_url": None},
    {"name": "Butterfly Maschine", "muscle_group": "Brust", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Aufrecht sitzen, Arme leicht gebeugt vor der Brust zusammenführen, langsam zurück.", "image_url": None},

    # --- Rücken ---
    {"name": "Klimmzüge", "muscle_group": "Rücken", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "REPS", "instructions": "Im Obergriff hängen, Brust zur Stange ziehen, kontrolliert ablassen.", "image_url": None},
    {"name": "Latzug", "muscle_group": "Rücken", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Stange breit greifen, zur oberen Brust ziehen, Ellbogen nach unten-hinten.", "image_url": None},
    {"name": "Langhantelrudern", "muscle_group": "Rücken", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Hüfte nach vorn geneigt, Rücken gerade, Langhantel zum Bauch ziehen.", "image_url": None},
    {"name": "Kurzhantelrudern einarmig", "muscle_group": "Rücken", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Eine Hand und Knie auf der Bank, Kurzhantel mit der freien Hand zur Hüfte ziehen.", "image_url": None},
    {"name": "Kreuzheben", "muscle_group": "Rücken", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Hüftbreiter Stand, Rücken gerade, Langhantel eng am Körper aus der Hüfte hochziehen.", "image_url": None},

    # --- Schultern ---
    {"name": "Schulterdrücken Kurzhantel", "muscle_group": "Schultern", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Aufrecht, Kurzhanteln aus Schulterhöhe über den Kopf drücken.", "image_url": None},
    {"name": "Seitheben", "muscle_group": "Schultern", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Leicht gebeugte Arme seitlich bis Schulterhöhe heben, langsam senken.", "image_url": None},
    {"name": "Frontheben", "muscle_group": "Schultern", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Kurzhanteln gestreckt nach vorn bis Schulterhöhe heben.", "image_url": None},
    {"name": "Face Pulls", "muscle_group": "Schultern", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Seil am Kabel auf Gesichtshöhe zum Kopf ziehen, Ellbogen hoch.", "image_url": None},

    # --- Bizeps ---
    {"name": "Langhantel Bizeps Curls", "muscle_group": "Bizeps", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Oberarme fix am Körper, Langhantel curlen, oben anspannen.", "image_url": None},
    {"name": "Hammer Curls", "muscle_group": "Bizeps", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Kurzhanteln im Neutralgriff (Daumen oben) curlen.", "image_url": None},

    # --- Trizeps ---
    {"name": "Trizepsdrücken Kabel", "muscle_group": "Trizeps", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Oberarme am Körper, Seil/Stange nach unten strecken, oben Ellbogen nah am Rumpf.", "image_url": None},
    {"name": "Dips", "muscle_group": "Trizeps", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "REPS", "instructions": "An Barren/Stuhl absenken bis Oberarme parallel, hochdrücken.", "image_url": None},
    {"name": "Enge Liegestütze", "muscle_group": "Trizeps", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Liegestütz mit enger Handstellung, Ellbogen eng am Körper.", "image_url": None},

    # --- Core ---
    {"name": "Plank", "muscle_group": "Core", "type": "AUFBAU", "location": "HOME", "tracking_type": "TIME", "instructions": "Unterarmstütz, Körper als gerade Linie halten, Bauch anspannen.", "image_url": None},
    {"name": "Crunches", "muscle_group": "Core", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Rückenlage, Oberkörper aus der Bauchspannung anheben, langsam ablassen.", "image_url": None},
    {"name": "Beinheben liegend", "muscle_group": "Core", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Rückenlage, gestreckte Beine bis senkrecht heben und kontrolliert senken.", "image_url": None},
    {"name": "Russian Twists", "muscle_group": "Core", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Sitzend leicht zurücklehnen, Oberkörper abwechselnd nach links und rechts drehen.", "image_url": None},
    {"name": "Dead Bug", "muscle_group": "Core", "type": "PHYSIO", "location": "HOME", "tracking_type": "REPS", "instructions": "Rückenlage, gegengleich Arm und Bein absenken, unterer Rücken bleibt am Boden.", "image_url": None},

    # --- Beine ---
    {"name": "Kniebeugen Langhantel", "muscle_group": "Beine", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Langhantel im Nacken, Hüfte nach hinten, bis Oberschenkel parallel, hochdrücken.", "image_url": None},
    {"name": "Goblet Squat", "muscle_group": "Beine", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Kurzhantel vor der Brust halten, tiefe Kniebeuge, Oberkörper aufrecht.", "image_url": None},
    {"name": "Ausfallschritte", "muscle_group": "Beine", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Großer Schritt nach vorn, hinteres Knie Richtung Boden, zurückdrücken. Gewicht optional.", "image_url": None},
    {"name": "Beinpresse", "muscle_group": "Beine", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Füße schulterbreit auf der Platte, kontrolliert beugen und strecken, Knie nicht durchdrücken.", "image_url": None},
    {"name": "Beinstrecker", "muscle_group": "Beine", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Sitzend Unterschenkel gegen den Widerstand strecken, oben kurz halten.", "image_url": None},
    {"name": "Beinbeuger", "muscle_group": "Beine", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Liegend oder sitzend Fersen gegen den Widerstand zum Gesäß ziehen.", "image_url": None},

    # --- Waden ---
    {"name": "Wadenheben stehend", "muscle_group": "Waden", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Auf die Fußballen hochdrücken, oben kurz halten, langsam absenken.", "image_url": None},

    # --- Gesäß ---
    {"name": "Hip Thrust", "muscle_group": "Gesäß", "type": "AUFBAU", "location": "STUDIO", "tracking_type": "WEIGHT_REPS", "instructions": "Oberer Rücken auf der Bank, Langhantel auf der Hüfte, Becken nach oben drücken, oben anspannen.", "image_url": None},
    {"name": "Glute Bridge", "muscle_group": "Gesäß", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Rückenlage, Füße aufgestellt, Becken hochdrücken bis Schulter-Knie eine Linie bilden.", "image_url": None},

    # --- Ganzkörper ---
    {"name": "Burpees", "muscle_group": "Ganzkörper", "type": "AUFBAU", "location": "HOME", "tracking_type": "REPS", "instructions": "Aus dem Stand in den Liegestütz, zurück und mit Strecksprung hoch.", "image_url": None},
    {"name": "Kettlebell Swing", "muscle_group": "Ganzkörper", "type": "AUFBAU", "location": "BEIDES", "tracking_type": "WEIGHT_REPS", "instructions": "Kettlebell aus der Hüfte explosiv bis Schulterhöhe schwingen, Rücken gerade.", "image_url": None},

    # --- Dehnen / Mobilität ---
    {"name": "Hamstring Dehnung sitzend", "muscle_group": "Mobilität", "type": "DEHNEN", "location": "HOME", "tracking_type": "TIME", "instructions": "Sitzend Beine gestreckt, Oberkörper Richtung Füße neigen, Dehnung halten.", "image_url": None},
    {"name": "Hüftbeuger Dehnung", "muscle_group": "Mobilität", "type": "DEHNEN", "location": "HOME", "tracking_type": "TIME", "instructions": "Ausfallschrittposition, Becken nach vorn schieben, vordere Hüfte dehnen, halten.", "image_url": None},
    {"name": "Brustdehnung Türrahmen", "muscle_group": "Mobilität", "type": "DEHNEN", "location": "HOME", "tracking_type": "TIME", "instructions": "Unterarm am Türrahmen, leicht nach vorn lehnen bis die Brust dehnt, halten.", "image_url": None},
    {"name": "Nackendehnung seitlich", "muscle_group": "Mobilität", "type": "DEHNEN", "location": "HOME", "tracking_type": "TIME", "instructions": "Kopf sanft zur Seite neigen, mit der Hand leicht nachhelfen, halten. Beide Seiten.", "image_url": None},
    {"name": "Katze Kuh", "muscle_group": "Mobilität", "type": "DEHNEN", "location": "HOME", "tracking_type": "REPS", "instructions": "Vierfüßlerstand, Rücken abwechselnd runden und ins Hohlkreuz absenken.", "image_url": None},

    # --- Physio ---
    {"name": "Schulter Außenrotation Theraband", "muscle_group": "Schultern", "type": "PHYSIO", "location": "HOME", "tracking_type": "REPS", "instructions": "Ellbogen am Körper fixiert, Unterarm gegen das Band nach außen rotieren.", "image_url": None},
    {"name": "Bird Dog", "muscle_group": "Core", "type": "PHYSIO", "location": "HOME", "tracking_type": "REPS", "instructions": "Vierfüßlerstand, gegengleich Arm und Bein strecken, kurz halten, wechseln.", "image_url": None},
    {"name": "Wandsitzen", "muscle_group": "Beine", "type": "PHYSIO", "location": "HOME", "tracking_type": "TIME", "instructions": "Rücken an der Wand, Knie 90 Grad, Position halten.", "image_url": None},
    {"name": "Nackenretraktion", "muscle_group": "Mobilität", "type": "PHYSIO", "location": "HOME", "tracking_type": "REPS", "instructions": "Kinn gerade nach hinten ziehen (Doppelkinn), kurz halten, lösen.", "image_url": None},
]
